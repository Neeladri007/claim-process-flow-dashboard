// Activity Flow Tree - JavaScript
// Backend API: Dash Server (Flask)

window.ActivityFlow = (function () {

    const API_BASE = '/api';
    let treeData = null;
    let tooltipTimeout;
    let currentClaimsData = [];
    let selectedNodeId = null;
    let initialStatsData = null;
    let sortState = { column: null, direction: 'asc' };

    // Fetch API wrapper
    async function fetchAPI(endpoint) {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    // Helper function to group children by process (Modified to NOT group, just sort)
    function groupChildrenByProcess(nodes) {
        // Just return the nodes, sorted by count
        // We clone to avoid mutating original if necessary
        const result = [...nodes];

        // Sort by count descending
        result.sort((a, b) => b.count - a.count);

        return result;
    }

    // Load all starting processes and display them with a START root node
    async function loadAllStartingProcesses(force = false) {
        // Check if we already have data and not forcing reload
        if (!force && treeData && initialStatsData) {
            console.log('Restoring existing tree state...');
            initModal();
            updateStats(initialStatsData);
            drawTree(treeData);
            hideLoading();
            return;
        }

        initModal();
        showLoading();

        try {
            const data = await fetchAPI('/activity-flow/starting-nodes');
            initialStatsData = data.total_claims; // Store for restoration

            // Group starting nodes
            const groupedNodes = groupChildrenByProcess(data.starting_nodes);

            // Create starting processes as children
            const startingNodes = groupedNodes.map(node => {
                // If it's a group, we need to handle it specially
                if (node.isGroup) {
                    return {
                        id: 'node_' + node.node_name,
                        name: node.process, // Display name
                        node_name: node.node_name, // Internal name
                        count: node.count,
                        percentage: node.percentage,
                        avgDuration: node.avg_duration_minutes,
                        medianDuration: node.median_duration,
                        maxDuration: node.max_duration,
                        path: [node.node_name],
                        children: [], // Children will be loaded on expand (or pre-loaded?)
                        storedChildren: node.children.map(c => ({
                            id: 'node_' + c.node_name,
                            name: c.node_name.split(' | ')[1] || c.node_name,
                            node_name: c.node_name,
                            count: c.count,
                            percentage: c.percentage,
                            avgDuration: c.avg_duration_minutes,
                            medianDuration: c.median_duration,
                            maxDuration: c.max_duration,
                            path: [c.node_name], // Path needs to be correct?
                            children: [],
                            hasChildren: false // Activities might have next steps, but here they are leaves of the group
                        })),
                        hasChildren: true,
                        isGroup: true,
                        activity_count: node.activity_count,
                        isStarting: true
                    };
                } else {
                    // Single activity
                    return {
                        id: 'node_' + node.node_name,
                        name: node.node_name.split(' | ')[1] || node.node_name,
                        node_name: node.node_name,
                        count: node.count,
                        percentage: node.percentage,
                        avgDuration: node.avg_duration_minutes,
                        medianDuration: node.median_duration,
                        maxDuration: node.max_duration,
                        path: [node.node_name],
                        children: [],
                        hasChildren: true,
                        isStarting: true
                    };
                }
            });

            // Create single root START node
            treeData = {
                id: 'root_start',
                name: 'START',
                count: data.total_claims,
                percentage: 100,
                avgDuration: 0,
                path: [],
                children: startingNodes,
                hasChildren: false,
                isRoot: true,
                expanded: true
            };

            // Update stats
            updateStats(data.total_claims);

            // Draw tree
            drawTree(treeData);

            hideLoading();
        } catch (error) {
            console.error('Error loading starting processes:', error);
            // alert('Failed to load starting processes.');
        }
    }

    // Expand a node by loading its children
    async function expandNode(nodeData) {
        if (nodeData.isTermination || nodeData.isRoot) {
            return;
        }

        // If it's a group node, we just show its stored children
        if (nodeData.isGroup && nodeData.storedChildren) {
            nodeData.children = nodeData.storedChildren.map(c => {
                let childPath;
                if (nodeData.isStarting) {
                    childPath = [c.node_name];
                } else {
                    childPath = [...nodeData.path, c.node_name];
                }

                return {
                    ...c,
                    id: 'node_' + childPath.join(';;'), // Unique ID
                    path: childPath,
                    hasChildren: true // Activities can be expanded
                };
            });

            nodeData.expanded = true;
            drawTree(treeData);
            return;
        }

        // Normal expansion (fetching from API)
        const fullPath = nodeData.path;
        const pathStr = fullPath.join(';;'); // Use ;; separator for activities

        console.log('Expanding:', nodeData.name, 'Path:', pathStr);

        try {
            const url = `/activity-flow/next-steps?path=${encodeURIComponent(pathStr)}`;
            const data = await fetchAPI(url);

            // Clear existing children
            nodeData.children = [];

            // Add termination
            if (data.terminations && data.terminations.count > 0) {
                const termPath = [...fullPath, 'END'];
                const termId = 'node_' + termPath.join(';;');

                nodeData.children.push({
                    id: termId,
                    name: '🏁 Terminated',
                    count: data.terminations.count,
                    percentage: data.terminations.percentage,
                    avgDuration: 0,
                    isTermination: true,
                    path: termPath
                });
            }

            // Add next steps
            if (data.next_steps && data.next_steps.length > 0) {
                const groupedSteps = groupChildrenByProcess(data.next_steps);

                for (const step of groupedSteps) {
                    if (step.isGroup) {
                        // It's a group
                        const childPath = [...fullPath]; // Group doesn't add to path for API calls, its children do
                        // But we need a unique ID for the group
                        const groupId = 'node_' + childPath.join(';;') + '_group_' + step.process;

                        nodeData.children.push({
                            id: groupId,
                            name: step.process,
                            node_name: step.node_name,
                            count: step.count,
                            percentage: step.percentage,
                            avgDuration: step.avg_duration_minutes,
                            medianDuration: step.median_duration,
                            maxDuration: step.max_duration,
                            meanCumulativeTime: step.mean_cumulative_time,
                            medianCumulativeTime: step.median_cumulative_time,
                            avgRemainingSteps: step.avg_remaining_steps,
                            path: childPath, // Path to parent
                            children: [],
                            storedChildren: step.children.map(c => ({
                                node_name: c.node_name,
                                name: c.node_name.split(' | ')[1] || c.node_name,
                                count: c.count,
                                percentage: c.percentage,
                                avgDuration: c.avg_duration_minutes,
                                medianDuration: c.median_duration,
                                maxDuration: c.max_duration,
                                // Path will be calculated when group is expanded
                            })),
                            hasChildren: true,
                            isGroup: true,
                            activity_count: step.activity_count
                        });
                    } else {
                        // Single activity
                        const childPath = [...fullPath, step.node_name];
                        const childId = 'node_' + childPath.join(';;');

                        nodeData.children.push({
                            id: childId,
                            name: step.node_name.split(' | ')[1] || step.node_name,
                            node_name: step.node_name,
                            count: step.count,
                            percentage: step.percentage,
                            avgDuration: step.avg_duration_minutes,
                            medianDuration: step.median_duration,
                            maxDuration: step.max_duration,
                            meanCumulativeTime: step.mean_cumulative_time,
                            medianCumulativeTime: step.median_cumulative_time,
                            avgRemainingSteps: step.avg_remaining_steps,
                            path: childPath,
                            children: [],
                            hasChildren: true
                        });
                    }
                }
            }

            nodeData.expanded = true;
            drawTree(treeData);
        } catch (error) {
            console.error('Error expanding node:', error);
            alert('Failed to load child nodes');
        }
    }

    // Collapse a node
    function collapseNode(nodeData) {
        nodeData.children = [];
        nodeData.expanded = false;
        drawTree(treeData);
    }

    // Reset layout function
    function resetLayout() {
        const svg = d3.select('#tree-svg');
        const zoom = svg.node().__zoomBehavior;

        // Reset zoom
        if (zoom) {
            svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
        }

        // Clear fixed positions recursively
        function clearFixed(node) {
            delete node.fx;
            delete node.fy;
            if (node.children) {
                node.children.forEach(clearFixed);
            }
        }

        if (treeData) {
            clearFixed(treeData);
            // Redraw to restart simulation
            drawTree(treeData);
        }
    }

    // Draw tree using D3 Force Layout (matching index.html)
    function drawTree(data) {
        const container = document.getElementById('tree-container');
        if (!container) return;

        container.style.display = 'block';
        const legend = document.getElementById('legend');
        if (legend) legend.style.display = 'flex';

        // Select container
        const containerSel = d3.select('#tree-container');

        // Check if SVG exists, if not create it
        let svg = containerSel.select('#tree-svg');
        if (svg.empty()) {
            svg = containerSel.append('svg').attr('id', 'tree-svg');

            // Add grid background class
            svg.attr('class', 'grid-background');

            // Add zoom group
            svg.append('g').attr('id', 'zoom-group');

            // Init zoom
            const zoom = d3.zoom()
                .scaleExtent([0.1, 4])
                .on('zoom', (event) => {
                    svg.select('#zoom-group').attr('transform', event.transform);
                });
            svg.call(zoom);

            // Store zoom behavior on svg node for reset
            svg.node().__zoomBehavior = zoom;
        }

        // Add Reset Button if not exists
        if (!document.getElementById('reset-chart-btn')) {
            const resetBtn = document.createElement('button');
            resetBtn.id = 'reset-chart-btn';
            resetBtn.className = 'reset-btn';
            resetBtn.innerHTML = '↺ Reset Chart';
            resetBtn.onclick = () => {
                // Reset zoom
                const svg = d3.select('#tree-svg');
                const zoom = svg.node().__zoomBehavior;
                if (zoom) {
                    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
                }
                // Reload data to reset state
                loadAllStartingProcesses(true);
            };
            container.style.position = 'relative';
            container.appendChild(resetBtn);
        }

        // Add Controls Guide if not exists
        if (!document.getElementById('controls-guide')) {
            const guide = document.createElement('div');
            guide.id = 'controls-guide';
            guide.className = 'controls-guide';
            guide.innerHTML = `
                <span>🖱️ Scroll to Zoom</span>
                <span>✋ Drag background to Pan</span>
                <span>📍 Drag nodes to Move</span>
            `;
            container.appendChild(guide);
        }

        // Clear existing SVG content (only inside zoom group)
        const g = svg.select('#zoom-group');
        g.selectAll('*').remove();

        // Calculate dimensions
        let maxDepth = 1;
        let maxChildren = 1;

        if (data) {
            const root = d3.hierarchy(data);
            let depth = 0;
            root.each(d => {
                depth = Math.max(depth, d.depth);
                if (d.children) {
                    maxChildren = Math.max(maxChildren, d.children.length);
                }
            });
            maxDepth = Math.max(maxDepth, depth);
        }

        const width = Math.max(container.clientWidth, maxChildren * 20);
        const height = Math.max(600, (maxDepth + 1) * 200 + 100);

        svg
            .attr('width', width)
            .attr('height', height);

        drawSingleTree(g, data, width, height);
    }

    function drawSingleTree(g, data, width, height) {
        const root = d3.hierarchy(data);
        const allNodes = [];
        const allLinks = [];

        root.each(d => {
            const node = {
                id: d.data.id || `${d.data.name}-${d.depth}`,
                data: d.data,
                depth: d.depth,
                parent: d.parent ? (d.parent.data.id || `${d.parent.data.name}-${d.parent.depth}`) : null
            };

            // Restore position if previously dragged
            if (d.data.fx !== undefined) {
                node.fx = d.data.fx;
                node.fy = d.data.fy;
                node.x = d.data.fx;
                node.y = d.data.fy;
            }

            allNodes.push(node);
        });

        root.links().forEach(link => {
            allLinks.push({
                source: link.source.data.id || `${link.source.data.name}-${link.source.depth}`,
                target: link.target.data.id || `${link.target.data.name}-${link.target.depth}`
            });
        });

        const getRadius = (d) => {
            if (d.data.isRoot) return 50;

            // Scale based on count, but keep reasonable bounds
            // We don't have global min/max easily accessible here without re-scanning, 
            // so let's use a simple log scale or just depth-based for now to match style
            const maxRadius = Math.max(30, 45 - (d.depth * 3));
            // const minRadius = Math.max(18, 25 - (d.depth * 2));

            // Simple sizing for now
            return maxRadius;
        };

        allNodes.forEach(d => {
            d.radius = getRadius(d);
        });

        const simulation = d3.forceSimulation(allNodes)
            .force('link', d3.forceLink(allLinks)
                .id(d => d.id)
                .distance(d => {
                    const childCount = allLinks.filter(l => (l.source.id || l.source) === (d.source.id || d.source)).length;
                    return childCount <= 1 ? 80 : 120;
                })
                .strength(0.8))
            .force('charge', d3.forceManyBody()
                .strength(d => d.data.isRoot ? -1500 : (-400 - (d.radius * 5))))
            .force('collision', d3.forceCollide()
                .radius(d => d.data.isRoot ? 80 : (d.radius + 20))
                .strength(1.0))
            .force('x', d3.forceX(width / 2).strength(d => d.data.isRoot ? 1 : 0.15))
            .force('y', d3.forceY(d => 100 + (d.depth * 140)).strength(d => d.data.isRoot ? 1 : 0.8))
            .alphaDecay(0.01)
            .velocityDecay(0.4);

        // Highlight path function
        function highlightPath(targetNode) {
            // Reset all links
            g.selectAll('.link').classed('highlighted', false);

            let curr = targetNode;
            while (curr.parent) {
                // Find link where target is curr
                g.selectAll('.link')
                    .filter(l => {
                        const targetId = (l.target && l.target.id) ? l.target.id : l.target;
                        return targetId === curr.id;
                    })
                    .classed('highlighted', true);

                // Move up to parent
                curr = allNodes.find(n => n.id === curr.parent);
                if (!curr) break;
            }
        }

        // Drag behavior
        function drag(simulation) {
            function dragstarted(event, d) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.startFx = d.fx;
                d.startFy = d.fy;
                d.fx = d.x;
                d.fy = d.y;
                d.hasMoved = false;
            }

            function dragged(event, d) {
                d.hasMoved = true;
                d.fx = event.x;
                d.fy = event.y;
                // Persist position
                d.data.fx = event.x;
                d.data.fy = event.y;
            }

            function dragended(event, d) {
                if (!event.active) simulation.alphaTarget(0);

                if (!d.hasMoved) {
                    d.fx = d.startFx;
                    d.fy = d.startFy;
                }

                delete d.startFx;
                delete d.startFy;
                delete d.hasMoved;
            }

            return d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended);
        }

        const links = g.selectAll('.link')
            .data(allLinks)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('stroke', '#ccc')
            .attr('stroke-width', 2);

        const nodes = g.selectAll('.node')
            .data(allNodes)
            .enter()
            .append('g')
            .attr('class', d => {
                let classes = 'node';
                if (d.data.isRoot) classes += ' root';
                if (d.data.isTermination) classes += ' termination';
                if (d.data.hasChildren && !d.data.expanded) classes += ' has-children';
                if (d.data.expanded) classes += ' expanded';
                return classes;
            })
            .call(drag(simulation))
            .on('mouseover', (event, d) => showTooltip(event, { data: d.data }))
            .on('mouseout', hideTooltip)
            .on('click', async function (event, d) {
                if (event.defaultPrevented) return; // Dragged
                event.stopPropagation();

                // Set selected node
                selectedNodeId = d.id;

                // Highlight path
                highlightPath(d);

                if (d.data.isTermination || d.data.isRoot) return;

                if (d.data.expanded) {
                    collapseNode(d.data);
                } else if (d.data.hasChildren) {
                    await expandNode(d.data);
                }
            });

        // Restore selection if exists
        if (selectedNodeId) {
            const targetNode = allNodes.find(n => n.id === selectedNodeId);
            if (targetNode) {
                // Use setTimeout to ensure links are rendered and simulation has started
                setTimeout(() => highlightPath(targetNode), 0);
            }
        }

        // Circles
        nodes.filter(d => !d.data.isRoot).append('circle')
            .attr('r', d => d.radius)
            .attr('fill', d => {
                if (d.data.isTermination) return '#fee2e2';
                if (d.data.expanded) return '#FFD000'; // Expanded
                if (d.data.hasChildren) return '#fffbeb'; // Has children (light yellow)
                return '#ffffff';
            })
            .attr('stroke', d => {
                if (d.data.isTermination) return '#ef4444';
                if (d.data.isGroup) return '#1A1446'; // Dark blue for groups
                return '#667eea';
            })
            .attr('stroke-width', d => d.data.isGroup ? 4 : 3);

        // Root Rect
        nodes.filter(d => d.data.isRoot).append('rect')
            .attr('x', -70)
            .attr('y', -35)
            .attr('width', 140)
            .attr('height', 70)
            .attr('rx', 8)
            .attr('ry', 8)
            .attr('fill', '#10b981')
            .attr('stroke', '#059669')
            .attr('stroke-width', 3);

        // Text
        nodes.append('text')
            .attr('dy', d => d.data.isRoot ? -45 : (-d.radius - 8))
            .attr('text-anchor', 'middle')
            .style('font-size', d => d.data.isRoot ? '16px' : '11px')
            .style('font-weight', d => d.data.isRoot ? 'bold' : '600')
            .style('fill', d => d.data.isRoot ? '#059669' : '#2c3e50')
            .each(function (d) {
                const text = d3.select(this);
                if (d.data.isRoot) {
                    text.text(d.data.name);
                } else {
                    // If group, show "Process Name"
                    // If activity, show "Activity Name"
                    const name = d.data.name;
                    const words = name.split(' ');
                    if (words.length > 2) {
                        text.append('tspan').attr('x', 0).attr('dy', 0).text(words.slice(0, 2).join(' '));
                        text.append('tspan').attr('x', 0).attr('dy', 11).text(words.slice(2).join(' '));
                    } else {
                        text.text(name);
                    }
                }
            });

        // Count
        nodes.append('text')
            .attr('class', 'count-text')
            .attr('dy', d => d.data.isRoot ? -5 : -2)
            .attr('text-anchor', 'middle')
            .style('font-weight', 'bold')
            .style('font-size', d => d.data.isRoot ? '18px' : Math.max(10, d.radius / 2.5) + 'px')
            .style('fill', d => d.data.isRoot ? 'white' : '#666')
            .text(d => d.data.count);

        // Root Label
        nodes.filter(d => d.data.isRoot).append('text')
            .attr('dy', 12)
            .attr('text-anchor', 'middle')
            .style('font-size', '11px')
            .style('font-weight', '500')
            .style('fill', 'white')
            .text('Claims');

        // Percentage
        nodes.filter(d => !d.data.isRoot).append('text')
            .attr('class', 'percentage-text')
            .attr('dy', 9)
            .attr('text-anchor', 'middle')
            .style('font-size', d => Math.max(9, d.radius / 3.2) + 'px')
            .text(d => d.data.percentage ? `${d.data.percentage}%` : '');

        // Group Indicator
        nodes.filter(d => d.data.isGroup).append('text')
            .attr('dy', d => d.radius + 18)
            .attr('text-anchor', 'middle')
            .style('font-size', '9px')
            .style('fill', '#1A1446')
            .style('font-weight', 'bold')
            .text(d => `(${d.data.activity_count} Activities)`);

        simulation.on('tick', () => {
            allNodes.forEach(d => {
                const padding = d.data.isRoot ? 80 : (d.radius + 50);
                d.x = Math.max(padding, Math.min(width - padding, d.x));
                d.y = Math.max(padding, Math.min(height - padding, d.y));
            });

            links
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            nodes.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        setTimeout(() => simulation.stop(), 3000);
    }

    function showTooltip(event, d) {
        const tooltip = document.getElementById('tooltip');
        if (!tooltip) return;

        // Clear any pending hide timeout
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }

        tooltip.style.display = 'block';

        let html = `<div class="tooltip-title">${d.data.name}</div>`;
        if (d.data.isGroup) {
            html += `<div>Process Group</div>`;
            html += `<div>Contains ${d.data.activity_count} activities</div>`;
        } else if (!d.data.isRoot && !d.data.isTermination) {
            // Show Process Name if available
            const parts = d.data.node_name.split(' | ');
            if (parts.length > 1) {
                html += `<div style="font-size: 11px; color: #aaa; margin-bottom: 4px;">Process: ${parts[0]}</div>`;
            }
        }
        html += `<div>Claims: ${d.data.count}</div>`;
        if (d.data.percentage && !d.data.isRoot) {
            html += `<div>Percentage: ${d.data.percentage}%</div>`;
        }

        if (!d.data.isRoot && !d.data.isTermination && !d.data.isGroup) {
            html += `<hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;">`;
            html += `<div style="font-weight: bold; margin-bottom: 3px;">Step Duration:</div>`;
            if (d.data.avgDuration !== undefined) {
                html += `<div>Avg: ${d.data.avgDuration} min</div>`;
            }
            if (d.data.medianDuration !== undefined) {
                html += `<div>Median: ${d.data.medianDuration} min</div>`;
            }
            if (d.data.maxDuration !== undefined) {
                html += `<div>Max: ${d.data.maxDuration} min</div>`;
            }

            if (d.data.meanCumulativeTime !== undefined || d.data.avgRemainingSteps !== undefined) {
                html += `<hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;">`;
                html += `<div style="font-weight: bold; margin-bottom: 3px;">Process Stats:</div>`;

                if (d.data.meanCumulativeTime !== undefined) {
                    html += `<div>Time from Start (Avg): ${d.data.meanCumulativeTime} min</div>`;
                }
                if (d.data.medianCumulativeTime !== undefined) {
                    html += `<div>Time from Start (Med): ${d.data.medianCumulativeTime} min</div>`;
                }
                if (d.data.avgRemainingSteps !== undefined) {
                    html += `<div>Avg Steps Remaining: ${d.data.avgRemainingSteps}</div>`;
                }
            }

            // Add Show Claims button
            const safePath = d.data.path.join(';;').replace(/'/g, "\\'");
            html += `<button class="tooltip-btn" onclick="window.ActivityFlow.openClaimsModal('${safePath}')">Show Claims</button>`;
        }

        tooltip.innerHTML = html;
        tooltip.style.left = (event.pageX + 15) + 'px';
        tooltip.style.top = (event.pageY + 15) + 'px';

        // Add event listeners to tooltip to keep it open
        tooltip.onmouseover = function () {
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
        };

        tooltip.onmouseout = function () {
            tooltipTimeout = setTimeout(function () {
                tooltip.style.display = 'none';
            }, 300);
        };
    }

    function hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        if (tooltip) {
            tooltipTimeout = setTimeout(function () {
                tooltip.style.display = 'none';
            }, 300);
        }
    }

    function updateStats(totalClaims) {
        const statsDiv = document.getElementById('stats');
        if (!statsDiv) return;
        statsDiv.style.display = 'flex';
        statsDiv.innerHTML = `
        <div class="stat-item">
            <div class="stat-icon-wrapper">
                📄
            </div>
            <div class="stat-content">
                <div class="stat-value">${totalClaims}</div>
                <div class="stat-label">Total Claims</div>
            </div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
            <div class="stat-icon-wrapper">
                🌳
            </div>
            <div class="stat-content">
                <div class="stat-value">Interactive</div>
                <div class="stat-label">Activity Tree</div>
            </div>
        </div>
    `;
    }

    function showLoading() {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'block';

        const treeContainer = document.getElementById('tree-container');
        if (treeContainer) treeContainer.style.display = 'none';

        const stats = document.getElementById('stats');
        if (stats) stats.style.display = 'none';

        const legend = document.getElementById('legend');
        if (legend) legend.style.display = 'none';
    }

    function hideLoading() {
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
    }

    // Initialize modal (same as ProcessFlow, checks existence)
    function initModal() {
        if (!document.getElementById('claimsModal')) {
            const modalHtml = `
                <div id="claimsModal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <span class="modal-title">Claims at this Step</span>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <button id="downloadBtn" class="download-btn" style="display:none; padding: 5px 10px; background-color: #1A1446; color: #FFD000; border: none; border-radius: 4px; cursor: pointer;">Download CSV</button>
                                <span class="close-modal" onclick="document.getElementById('claimsModal').style.display='none'">&times;</span>
                            </div>
                        </div>
                        <div class="modal-body">
                            <div id="modalLoading" style="text-align: center; padding: 20px;">
                                <div class="spinner"></div>
                                <p>Loading claims...</p>
                            </div>
                            <div id="claimsListContent" style="display: none;">
                                <div style="margin-bottom: 15px; font-style: italic; color: #666;">
                                    Showing claims that followed the path: <span id="modalPathDisplay" style="font-weight: bold; color: #1A1446;"></span>
                                </div>
                                <table class="claims-table">
                                    <thead>
                                        <tr>
                                            <th>Claim Number</th>
                                            <th style="cursor: pointer;" onclick="window.ActivityFlow.sortClaims('total_duration')">
                                                Total Duration (min) <span id="sort-icon-total_duration" style="font-size: 0.8em; margin-left: 5px;">↕</span>
                                            </th>
                                            <th style="cursor: pointer;" onclick="window.ActivityFlow.sortClaims('remaining_duration')">
                                                Remaining Duration (min) <span id="sort-icon-remaining_duration" style="font-size: 0.8em; margin-left: 5px;">↕</span>
                                            </th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody id="claimsTableBody">
                                        <!-- Rows will be added here -->
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            // Close modal when clicking outside
            window.onclick = function (event) {
                const modal = document.getElementById('claimsModal');
                if (event.target == modal) {
                    modal.style.display = "none";
                }
            }
        }
    }

    // Sort claims
    function sortClaims(column) {
        if (sortState.column === column) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.column = column;
            sortState.direction = 'asc';
        }

        currentClaimsData.sort((a, b) => {
            let valA = a[column];
            let valB = b[column];

            // Handle nulls/undefined
            if (valA === null || valA === undefined) valA = -Infinity;
            if (valB === null || valB === undefined) valB = -Infinity;

            if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
            return 0;
        });

        renderClaimsTable();
    }

    // Render claims table
    function renderClaimsTable() {
        const tbody = document.getElementById('claimsTableBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        // Update icons
        ['total_duration', 'remaining_duration'].forEach(col => {
            const icon = document.getElementById(`sort-icon-${col}`);
            if (icon) {
                if (sortState.column === col) {
                    icon.textContent = sortState.direction === 'asc' ? '↑' : '↓';
                } else {
                    icon.textContent = '↕';
                }
            }
        });

        if (currentClaimsData && currentClaimsData.length > 0) {
            currentClaimsData.forEach(claim => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${claim.Claim_Number}</td>
                    <td>${claim.total_duration}</td>
                    <td>${claim.remaining_duration}</td>
                    <td>
                        <button class="claim-link-btn" onclick="window.ActivityFlow.viewClaim(${claim.Claim_Number})">
                            View Full Track
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No claims found for this path.</td></tr>';
        }
    }

    // Open claims modal
    async function openClaimsModal(pathStr) {
        const modal = document.getElementById('claimsModal');
        const loading = document.getElementById('modalLoading');
        const content = document.getElementById('claimsListContent');
        const pathDisplay = document.getElementById('modalPathDisplay');
        const downloadBtn = document.getElementById('downloadBtn');

        if (!modal) return;

        modal.style.display = "block";
        loading.style.display = "block";
        content.style.display = "none";
        if (downloadBtn) downloadBtn.style.display = 'none';

        // Format path for display
        const pathArr = pathStr.split(';;');
        // For activity flow, we might want to show just the activity names
        const displayPath = pathArr.map(p => p.split(' | ')[1] || p).join(' → ');
        pathDisplay.textContent = displayPath;

        try {
            const data = await fetchAPI(`/claims-at-step?path=${encodeURIComponent(pathStr)}&type=activity`);
            currentClaimsData = data.claims || [];

            // Reset sort state
            sortState = { column: null, direction: 'asc' };
            renderClaimsTable();

            if (data.claims && data.claims.length > 0) {
                if (downloadBtn) {
                    downloadBtn.style.display = 'inline-block';
                    downloadBtn.onclick = () => downloadCSV(pathStr.replace(/;;/g, '_').replace(/ \| /g, '-'));
                }
            }

            loading.style.display = "none";
            content.style.display = "block";

        } catch (error) {
            console.error('Error fetching claims:', error);
            loading.innerHTML = '<p style="color:red">Error loading claims.</p>';
        }
    }

    function downloadCSV(filenamePrefix) {
        if (!currentClaimsData || currentClaimsData.length === 0) return;

        const headers = Object.keys(currentClaimsData[0]);
        const csvContent = [
            headers.join(','),
            ...currentClaimsData.map(row => headers.map(fieldName => JSON.stringify(row[fieldName], (key, value) => value === null ? '' : value)).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `claims_${filenamePrefix}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    // Close modal
    function closeModal() {
        const modal = document.getElementById('claimsModal');
        if (modal) {
            modal.style.display = "none";
        }
    }

    // View specific claim
    function viewClaim(claimNumber) {
        // Open in new tab
        window.open(`/?claim=${claimNumber}`, '_blank');

        // Close modal in current tab
        closeModal();
    }

    return {
        init: loadAllStartingProcesses,
        openClaimsModal: openClaimsModal,
        closeModal: closeModal,
        viewClaim: viewClaim,
        sortClaims: sortClaims
    };

})();

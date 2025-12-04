// Claim Process Flow Tree - JavaScript
// Backend API: Dash Server (Flask)

window.ProcessFlow = (function () {

    const API_BASE = '/api';
    let treeData = null;
    let allStartingProcesses = [];
    let tooltipTimeout;
    let currentClaimsData = [];
    let selectedNodeId = null;
    let initialStatsData = null;
    let sortState = { column: null, direction: 'asc' };
    let viewMode = 'detailed'; // 'detailed' or 'aggregated'

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
            const data = await fetchAPI(`/starting-processes?mode=${viewMode}`);
            allStartingProcesses = data.starting_processes;
            initialStatsData = data; // Store for restoration

            // Calculate total claims
            const totalClaims = data.total_claims || allStartingProcesses.reduce((sum, sp) => sum + sp.count, 0);

            // Create starting processes as children
            const startingNodes = allStartingProcesses.map(sp => ({
                id: 'node_' + sp.process,  // Unique ID for starting nodes
                name: sp.process,
                count: sp.count,
                percentage: sp.percentage,
                percentageOfTotal: sp.percentage_of_total,
                avgDuration: sp.avg_duration || 0,
                stdDuration: sp.std_duration || 0,
                medianDuration: sp.median_duration || 0,
                maxDuration: sp.max_duration || 0,
                path: [sp.process],
                children: [],
                hasChildren: true,
                isStarting: true
            }));

            // Create single root START node with all starting processes as children
            treeData = {
                id: 'root_start',
                name: 'START',
                count: totalClaims,
                percentage: 100,
                avgDuration: 0,
                path: [],
                children: startingNodes,
                hasChildren: false,
                isRoot: true,
                expanded: true
            };

            // Update stats
            updateStats(data);

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
            return; // Cannot expand termination or root nodes
        }

        // Use the node's own path if it has one, otherwise build it
        const fullPath = nodeData.path || (nodeData.isStarting ? [nodeData.name] : [nodeData.name]);

        console.log('=== Expanding Node ===');
        console.log('Node name:', nodeData.name);
        console.log('Node count:', nodeData.count);
        console.log('Full path:', fullPath.join(' → '));
        console.log('Is starting:', nodeData.isStarting);

        try {
            // Fetch children using appropriate API
            let data;
            if (nodeData.isStarting) {
                // For starting nodes, use the starting filter
                const url = `/process-flow/${encodeURIComponent(nodeData.name)}?filter_type=starting&mode=${viewMode}`;
                console.log('API call:', url);
                data = await fetchAPI(url);
            } else {
                // For subsequent nodes, use path-based API
                const pathStr = fullPath.join(',');
                const url = `/process-flow-after-path?path=${encodeURIComponent(pathStr)}&mode=${viewMode}`;
                console.log('API call:', url);
                data = await fetchAPI(url);
            }

            console.log('API response:', data);

            // Clear existing children and add new ones
            nodeData.children = [];

            // Add termination
            if (data.terminations && data.terminations.count > 0) {
                const termPath = [...fullPath, 'END'];
                const termId = 'node_' + termPath.join('->');

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
                for (const step of data.next_steps) {
                    // Create unique ID based on full path to prevent convergence
                    const childPath = [...fullPath, step.process];
                    const childId = 'node_' + childPath.join('->');

                    nodeData.children.push({
                        id: childId,  // Unique identifier based on full path
                        name: step.process,
                        count: step.count,  // This is the actual flow count from this parent
                        percentage: step.percentage,
                        percentageOfTotal: step.percentage_of_total,
                        avgDuration: step.avg_duration_minutes || step.avg_duration || 0,
                        stdDuration: step.std_duration || 0,
                        medianDuration: step.median_duration || 0,
                        maxDuration: step.max_duration || 0,
                        meanCumulativeTime: step.mean_cumulative_time || 0,
                        medianCumulativeTime: step.median_cumulative_time || 0,
                        avgRemainingSteps: step.avg_remaining_steps || 0,
                        path: childPath,  // Store full path including this node
                        children: [],
                        hasChildren: true,
                        parentCount: nodeData.count  // Store parent count for validation
                    });
                }
            }

            nodeData.expanded = true;

            // Validation: check if child counts sum correctly
            const totalChildCount = nodeData.children.reduce((sum, child) => sum + child.count, 0);
            console.log(`Expanded ${nodeData.name}: parent count=${nodeData.count}, children sum=${totalChildCount}`);
            if (totalChildCount !== nodeData.count && !nodeData.isStarting) {
                console.warn(`Warning: Children counts don't match parent! Path: ${fullPath.join(' → ')}`);
            }

            // Redraw tree with updated data
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

        // Redraw entire tree
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

    // Draw tree using D3
    function drawTree(data) {
        const container = document.getElementById('tree-container');
        if (!container) return; // Guard clause

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

        // Add View Mode Toggle if not exists
        if (!document.getElementById('view-mode-btn')) {
            const viewBtn = document.createElement('button');
            viewBtn.id = 'view-mode-btn';
            viewBtn.className = viewMode === 'detailed' ? 'view-mode-btn detailed' : 'view-mode-btn aggregated';
            viewBtn.innerHTML = viewMode === 'detailed' ? '👁️ Show Phases' : '🔍 Show Details';
            viewBtn.style.marginLeft = '10px';
            viewBtn.onclick = toggleViewMode;
            container.appendChild(viewBtn);
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

        // Calculate required dimensions based on data
        let maxDepth = 1;
        let maxChildren = 1;

        // Now data is always a single root object
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

        // Set dimensions dynamically
        const width = Math.max(container.clientWidth, maxChildren * 120);
        const height = Math.max(600, (maxDepth + 1) * 200 + 100);

        svg
            .attr('width', width)
            .attr('height', height);

        // Draw single tree with START root
        drawSingleTree(g, data, width, height);
    }

    // Draw single tree (when not at root level)
    function drawSingleTree(g, data, width, height) {
        // Convert tree data to flat array for force simulation
        const root = d3.hierarchy(data);
        const allNodes = [];
        const allLinks = [];

        // Flatten all nodes
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

        // Create links
        root.links().forEach(link => {
            allLinks.push({
                source: link.source.data.id || `${link.source.data.name}-${link.source.depth}`,
                target: link.target.data.id || `${link.target.data.name}-${link.target.depth}`
            });
        });

        // Calculate node radius based on count and depth
        const getRadius = (d) => {
            const nodesAtDepth = allNodes.filter(n => n.depth === d.depth);
            const counts = nodesAtDepth.map(n => n.data.count || 1);
            const minCount = Math.min(...counts);
            const maxCount = Math.max(...counts);

            // Root node gets fixed larger radius
            if (d.data.isRoot) return 50;

            const maxRadius = Math.max(30, 45 - (d.depth * 3));
            const minRadius = Math.max(18, 25 - (d.depth * 2));

            const scale = d3.scaleSqrt()
                .domain([minCount, maxCount])
                .range([minRadius, maxRadius]);

            return scale(d.data.count || 1);
        };

        // Add radius to nodes
        allNodes.forEach(d => {
            d.radius = getRadius(d);
        });

        // Create force simulation with stronger centering for START node
        const simulation = d3.forceSimulation(allNodes)
            .force('link', d3.forceLink(allLinks)
                .id(d => d.id)
                .distance(d => {
                    const sourceNode = allNodes.find(n => n.id === d.source.id || n.id === d.source);
                    const childCount = allLinks.filter(l => (l.source.id || l.source) === (d.source.id || d.source)).length;
                    // Much shorter for linear paths
                    return childCount <= 1 ? 80 : 120;
                })
                .strength(0.8))
            .force('charge', d3.forceManyBody()
                .strength(d => d.data.isRoot ? -1500 : (-400 - (d.radius * 5))))
            .force('collision', d3.forceCollide()
                .radius(d => d.data.isRoot ? 80 : (d.radius + 20))
                .strength(1.0))
            .force('x', d3.forceX(d => d.data.isRoot ? width / 2 : width / 2).strength(d => d.data.isRoot ? 1 : 0.15))
            .force('y', d3.forceY(d => {
                return d.data.isRoot ? 100 : (100 + (d.depth * 140));
            }).strength(d => d.data.isRoot ? 1 : 0.8))
            .alphaDecay(0.01)  // Slower decay for better settling
            .velocityDecay(0.4);  // Moderate friction

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

        // Draw links
        const links = g.selectAll('.link')
            .data(allLinks)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('stroke', '#ccc')
            .attr('stroke-width', 2);

        // Draw nodes
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
                if (d.data.name === 'Investigation') classes += ' investigation-node';
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

        // Add circles for non-root nodes
        nodes.filter(d => !d.data.isRoot).append('circle')
            .attr('r', d => d.radius)
            .attr('fill', d => {
                if (d.data.name === 'Investigation') return '#c7d2fe';
                return '#fff';
            })
            .attr('stroke', d => {
                if (d.data.name === 'Investigation') return '#6366f1';
                return '#667eea';
            })
            .attr('stroke-width', 3);

        // Add rectangle for START root node
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

        // Add process name
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
                    const words = d.data.name.split(' ');
                    if (words.length > 2) {
                        text.append('tspan')
                            .attr('x', 0)
                            .attr('dy', 0)
                            .text(words.slice(0, 2).join(' '));
                        text.append('tspan')
                            .attr('x', 0)
                            .attr('dy', 11)
                            .text(words.slice(2).join(' '));
                    } else {
                        text.text(d.data.name);
                    }
                }
            });

        // Add count inside node
        nodes.append('text')
            .attr('class', 'count-text')
            .attr('dy', d => d.data.isRoot ? -5 : -2)
            .attr('text-anchor', 'middle')
            .style('font-weight', 'bold')
            .style('font-size', d => d.data.isRoot ? '18px' : Math.max(10, d.radius / 2.5) + 'px')
            .style('fill', d => d.data.isRoot ? 'white' : '#666')
            .text(d => d.data.count);

        // Add "Claims" label for root node
        nodes.filter(d => d.data.isRoot).append('text')
            .attr('dy', 12)
            .attr('text-anchor', 'middle')
            .style('font-size', '11px')
            .style('font-weight', '500')
            .style('fill', 'white')
            .text('Claims');

        // Add percentage (not for root)
        nodes.filter(d => !d.data.isRoot).append('text')
            .attr('class', 'percentage-text')
            .attr('dy', 9)
            .attr('text-anchor', 'middle')
            .style('font-size', d => Math.max(9, d.radius / 3.2) + 'px')
            .text(d => d.data.percentage ? `${d.data.percentage}%` : '');

        // Update positions on tick
        simulation.on('tick', () => {
            // Constrain nodes within bounds
            allNodes.forEach(d => {
                const padding = d.data.isRoot ? 80 : (d.radius + 50);
                d.x = Math.max(padding, Math.min(width - padding, d.x));
                d.y = Math.max(padding, Math.min(height - padding, d.y));
            });

            links
                .attr('x1', d => {
                    const source = allNodes.find(n => n.id === d.source.id || n.id === d.source);
                    return source ? source.x : 0;
                })
                .attr('y1', d => {
                    const source = allNodes.find(n => n.id === d.source.id || n.id === d.source);
                    return source ? source.y : 0;
                })
                .attr('x2', d => {
                    const target = allNodes.find(n => n.id === d.target.id || n.id === d.target);
                    return target ? target.x : 0;
                })
                .attr('y2', d => {
                    const target = allNodes.find(n => n.id === d.target.id || n.id === d.target);
                    return target ? target.y : 0;
                });

            nodes.attr('transform', d => `translate(${d.x},${d.y})`);
        });

        // Let simulation run longer to properly settle nodes
        setTimeout(() => simulation.stop(), 3000);
    }

    // Tooltip functions
    function showTooltip(event, d) {
        const tooltip = document.getElementById('tooltip');

        // Clear any pending hide timeout
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }

        tooltip.style.display = 'block';

        let html = `<div class="tooltip-title">${d.data.name}</div>`;
        html += `<div>Claims: ${d.data.count}</div>`;
        if (d.data.percentage && !d.data.isRoot) {
            html += `<div>Percentage: ${d.data.percentage}%</div>`;
            if (d.data.percentageOfTotal) {
                html += `<div>% of Total Claims: ${d.data.percentageOfTotal}%</div>`;
            }
        }

        if (!d.data.isRoot && !d.data.isTermination) {
            html += `<hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;">`;
            html += `<div style="font-weight: bold; margin-bottom: 3px;">Step Duration:</div>`;
            if (d.data.avgDuration !== undefined) {
                html += `<div>Avg: ${d.data.avgDuration} min</div>`;
            }
            if (d.data.stdDuration !== undefined) {
                html += `<div>Std Dev: ${d.data.stdDuration} min</div>`;
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
        }

        if (d.data.totalFlows) {
            html += `<div>Total Flows: ${d.data.totalFlows}</div>`;
        }
        if (d.data.isRoot) {
            html += `<div style="margin-top: 8px; font-style: italic; color: #667eea;">Root node - all claims start here</div>`;
        } else {
            // Add Show Claims button for non-root nodes
            html += `<button class="tooltip-btn" onclick="window.ProcessFlow.openClaimsModal('${d.data.path.join(',')}')">Show Claims</button>`;
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
        tooltipTimeout = setTimeout(function () {
            document.getElementById('tooltip').style.display = 'none';
        }, 300);
    }

    // Update stats bar
    function updateStats(data) {
        const statsDiv = document.getElementById('stats');
        statsDiv.style.display = 'flex';

        let totalClaims = data.total_claims || 0;
        let totalProcesses = data.starting_processes ? data.starting_processes.length : 0;

        statsDiv.innerHTML = `
        <div class="stat-item">
            <div class="stat-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            </div>
            <div class="stat-content">
                <div class="stat-value">${totalClaims}</div>
                <div class="stat-label">Total Claims</div>
            </div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
            <div class="stat-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                </svg>
            </div>
            <div class="stat-content">
                <div class="stat-value">${totalProcesses}</div>
                <div class="stat-label">Starting Processes</div>
            </div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
            <div class="stat-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
            </div>
            <div class="stat-content">
                <div class="stat-value">Interactive</div>
                <div class="stat-label">Process Tree</div>
            </div>
        </div>
    `;
    }

    function showLoading() {
        document.getElementById('loading').style.display = 'block';
        document.getElementById('tree-container').style.display = 'none';
        document.getElementById('stats').style.display = 'none';
        document.getElementById('legend').style.display = 'none';
    }

    function hideLoading() {
        document.getElementById('loading').style.display = 'none';
    }

    // Initialize modal
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
                                            <th style="cursor: pointer;" onclick="window.ProcessFlow.sortClaims('total_duration')">
                                                Total Duration (min) <span id="sort-icon-total_duration" style="font-size: 0.8em; margin-left: 5px;">↕</span>
                                            </th>
                                            <th style="cursor: pointer;" onclick="window.ProcessFlow.sortClaims('remaining_duration')">
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
                        <button class="claim-link-btn" onclick="window.ProcessFlow.viewClaim(${claim.Claim_Number})">
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
        const pathArr = pathStr.split(',');
        pathDisplay.textContent = pathArr.join(' → ');

        try {
            const data = await fetchAPI(`/claims-at-step?path=${encodeURIComponent(pathStr)}&type=process&mode=${viewMode}`);
            currentClaimsData = data.claims || [];

            // Reset sort state
            sortState = { column: null, direction: 'asc' };
            renderClaimsTable();

            if (data.claims && data.claims.length > 0) {
                if (downloadBtn) {
                    downloadBtn.style.display = 'inline-block';
                    downloadBtn.onclick = () => downloadCSV(pathStr.replace(/,/g, '_'));
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

    function toggleViewMode() {
        viewMode = viewMode === 'detailed' ? 'aggregated' : 'detailed';
        const btn = document.getElementById('view-mode-btn');
        if (btn) {
            btn.innerHTML = viewMode === 'detailed' ? '👁️ Show Phases' : '🔍 Show Details';
            btn.className = viewMode === 'detailed' ? 'view-mode-btn detailed' : 'view-mode-btn aggregated';
        }
        // Force reload
        loadAllStartingProcesses(true);
    }

    return {
        init: loadAllStartingProcesses,
        openClaimsModal: openClaimsModal,
        closeModal: closeModal,
        viewClaim: viewClaim,
        sortClaims: sortClaims,
        toggleViewMode: toggleViewMode
    };

})();


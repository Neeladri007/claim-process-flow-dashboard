// Activity Flow Tree - JavaScript
// Backend API: Relative path to work with both FastAPI and Dash

const API_BASE = '/api';
let treeData = null;

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
async function loadAllStartingProcesses() {
    showLoading();

    try {
        const data = await fetchAPI('/activity-flow/starting-nodes');

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
                    path: [node.node_name],
                    children: [], // Children will be loaded on expand (or pre-loaded?)
                    // Actually, for groups, we already HAVE the children in node.children
                    // But to fit the "expand" model, we can treat them as children to be "expanded"
                    // Or we can pre-load them. Let's pre-load them into _children or similar?
                    // The force layout expects `children` to be the visible children.
                    // If we want them collapsed initially, `children` should be empty, and we store real children elsewhere.
                    storedChildren: node.children.map(c => ({
                        id: 'node_' + c.node_name,
                        name: c.node_name.split(' | ')[1] || c.node_name,
                        node_name: c.node_name,
                        count: c.count,
                        percentage: c.percentage,
                        avgDuration: c.avg_duration_minutes,
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
        alert('Failed to load starting processes.');
    }
}

// Expand a node by loading its children
async function expandNode(nodeData) {
    if (nodeData.isTermination || nodeData.isRoot) {
        return;
    }

    // If it's a group node, we just show its stored children
    if (nodeData.isGroup && nodeData.storedChildren) {
        // We need to make sure the children have the correct path context if they are going to be expanded further
        // But wait, the activities inside a group are just activities. They can be expanded to show NEXT steps.
        // So we need to make sure their path is correct.
        // The path for an activity inside a group is just [activity_node_name] (if starting) or [...parent_path, activity_node_name]

        // Actually, the group node itself is artificial. The path should track the actual activity sequence.
        // So if I expand a group, I see activities. If I click an activity, I want to see what happens NEXT.
        // The path for that activity should be the path to get TO that activity.
        // Since these are starting nodes, the path is just [activity_node_name].

        // Let's just use the stored children, but we need to ensure they are formatted correctly for the tree.
        // We need to clone them to avoid issues if we collapse/expand multiple times?
        nodeData.children = nodeData.storedChildren.map(c => {
            // Update path based on parent's path context? 
            // If parent is a starting group, parent path is [Group]. That's not useful for API.
            // The activity itself is the start. So path is [activity.node_name].
            // If the group is later in the chain, say A -> Group(B, C).
            // Path to B is [A, B]. Path to C is [A, C].

            // For now, let's assume we are only grouping at the current level.
            // If nodeData is a group, its path is likely artificial or representative.
            // We need to construct the path for the children correctly.

            let childPath;
            if (nodeData.isStarting) {
                childPath = [c.node_name];
            } else {
                // If we are deep in the tree, nodeData.path leads to this group.
                // But wait, a group node represents "Next step is Process X".
                // So the previous steps are in nodeData.path (excluding the group itself?).
                // Actually, if I have A -> Group(B, C).
                // The path to Group is [A].
                // The path to B should be [A, B].
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
                        path: childPath, // Path to parent
                        children: [],
                        storedChildren: step.children.map(c => ({
                            node_name: c.node_name,
                            name: c.node_name.split(' | ')[1] || c.node_name,
                            count: c.count,
                            percentage: c.percentage,
                            avgDuration: c.avg_duration_minutes,
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

// Draw tree using D3 Force Layout (matching index.html)
function drawTree(data) {
    const container = document.getElementById('tree-container');
    container.style.display = 'block';
    document.getElementById('legend').style.display = 'flex';

    // Clear existing SVG
    d3.select('#tree-svg').selectAll('*').remove();

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

    const width = Math.max(1800, container.clientWidth, maxChildren * 180);
    const height = Math.max(600, (maxDepth + 1) * 200 + 100);

    const svg = d3.select('#tree-svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g')
        .attr('transform', 'translate(0, 20)');

    drawSingleTree(g, data, width, height);
}

function drawSingleTree(g, data, width, height) {
    const root = d3.hierarchy(data);
    const allNodes = [];
    const allLinks = [];

    root.each(d => {
        allNodes.push({
            id: d.data.id || `${d.data.name}-${d.depth}`,
            data: d.data,
            depth: d.depth,
            parent: d.parent ? (d.parent.data.id || `${d.parent.data.name}-${d.parent.depth}`) : null
        });
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
        .on('mouseover', (event, d) => showTooltip(event, { data: d.data }))
        .on('mouseout', hideTooltip)
        .on('click', async function (event, d) {
            event.stopPropagation();
            if (d.data.isTermination || d.data.isRoot) return;

            if (d.data.expanded) {
                collapseNode(d.data);
            } else if (d.data.hasChildren) {
                await expandNode(d.data);
            }
        });

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

    // Duration
    nodes.filter(d => !d.data.isRoot && d.data.avgDuration > 0).append('text')
        .attr('class', 'duration-text')
        .attr('dy', d => d.radius + 34)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('fill', '#999')
        .text(d => `${d.data.avgDuration}m`);

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
    if (d.data.avgDuration !== undefined && d.data.avgDuration > 0 && !d.data.isRoot) {
        html += `<div>Avg Duration: ${d.data.avgDuration} min</div>`;
    }

    tooltip.innerHTML = html;
    tooltip.style.left = (event.pageX + 15) + 'px';
    tooltip.style.top = (event.pageY + 15) + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
}

function updateStats(totalClaims) {
    const statsDiv = document.getElementById('stats');
    statsDiv.style.display = 'flex';
    statsDiv.innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${totalClaims}</div>
            <div class="stat-label">Total Claims</div>
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAllStartingProcesses();
});

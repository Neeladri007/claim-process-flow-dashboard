// Claim Process Flow Tree - JavaScript
// Backend API: main.py (FastAPI on port 8000)

const API_BASE = 'http://localhost:8000/api';
let treeData = null;
let allStartingProcesses = [];

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
async function loadAllStartingProcesses() {
    showLoading();

    try {
        const data = await fetchAPI('/starting-processes');
        allStartingProcesses = data.starting_processes;

        // Calculate total claims
        const totalClaims = data.total_claims || allStartingProcesses.reduce((sum, sp) => sum + sp.count, 0);

        // Create starting processes as children
        const startingNodes = allStartingProcesses.map(sp => ({
            id: 'node_' + sp.process,  // Unique ID for starting nodes
            name: sp.process,
            count: sp.count,
            percentage: sp.percentage,
            avgDuration: sp.avg_duration || 0,
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
        alert('Failed to load starting processes. Make sure the FastAPI server is running on port 8000.');
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
            const url = `/process-flow/${encodeURIComponent(nodeData.name)}?filter_type=starting`;
            console.log('API call:', url);
            data = await fetchAPI(url);
        } else {
            // For subsequent nodes, use path-based API
            const pathStr = fullPath.join(',');
            const url = `/process-flow-after-path?path=${encodeURIComponent(pathStr)}`;
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
                    avgDuration: step.avg_duration_minutes || step.avg_duration || 0,
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

// Draw tree using D3
function drawTree(data) {
    const container = document.getElementById('tree-container');
    container.style.display = 'block';
    document.getElementById('legend').style.display = 'flex';

    // Clear existing SVG
    d3.select('#tree-svg').selectAll('*').remove();

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
    const width = Math.max(1800, container.clientWidth, maxChildren * 180);
    const height = Math.max(600, (maxDepth + 1) * 200 + 100);

    const svg = d3.select('#tree-svg')
        .attr('width', width)
        .attr('height', height);

    const g = svg.append('g')
        .attr('transform', 'translate(0, 20)');

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
        allNodes.push({
            id: d.data.id || `${d.data.name}-${d.depth}`,
            data: d.data,
            depth: d.depth,
            parent: d.parent ? (d.parent.data.id || `${d.parent.data.name}-${d.parent.depth}`) : null
        });
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

    // Add circles for non-root nodes
    nodes.filter(d => !d.data.isRoot).append('circle')
        .attr('r', d => d.radius)
        .attr('fill', '#fff')
        .attr('stroke', '#667eea')
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

    // Add avg duration below node (not for root)
    nodes.filter(d => !d.data.isRoot && d.data.avgDuration > 0).append('text')
        .attr('class', 'duration-text')
        .attr('dy', d => d.radius + 34)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('fill', '#999')
        .text(d => `${d.data.avgDuration}m`);

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
    tooltip.style.display = 'block';

    let html = `<div class="tooltip-title">${d.data.name}</div>`;
    html += `<div>Claims: ${d.data.count}</div>`;
    if (d.data.percentage && !d.data.isRoot) {
        html += `<div>Percentage: ${d.data.percentage}%</div>`;
    }
    if (d.data.avgDuration !== undefined && d.data.avgDuration > 0 && !d.data.isRoot) {
        html += `<div>Avg Duration: ${d.data.avgDuration} min</div>`;
    }
    if (d.data.totalFlows) {
        html += `<div>Total Flows: ${d.data.totalFlows}</div>`;
    }
    if (d.data.isRoot) {
        html += `<div style="margin-top: 8px; font-style: italic; color: #667eea;">Root node - all claims start here</div>`;
    }

    tooltip.innerHTML = html;
    tooltip.style.left = (event.pageX + 15) + 'px';
    tooltip.style.top = (event.pageY + 15) + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
}

// Update stats bar
function updateStats(data) {
    const statsDiv = document.getElementById('stats');
    statsDiv.style.display = 'flex';

    let totalClaims = data.total_claims || 0;
    let totalProcesses = data.starting_processes ? data.starting_processes.length : 0;

    statsDiv.innerHTML = `
        <div class="stat-item">
            <div class="stat-value">${totalClaims}</div>
            <div class="stat-label">Total Claims</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">${totalProcesses}</div>
            <div class="stat-label">Starting Processes</div>
        </div>
        <div class="stat-item">
            <div class="stat-value">Click to Expand</div>
            <div class="stat-label">Interactive Tree</div>
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

// Initialize - Load all starting processes
window.onload = loadAllStartingProcesses;

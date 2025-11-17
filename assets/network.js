// Network visualization with D3.js force simulation

let svg, g, simulation, nodes = [], links = [], currentNodes = [];
let width, height;
let tooltip;

const COLORS = {
    'Total Loss': '#FF6B6B',
    'Liability': '#4ECDC4',
    'Coverage': '#45B7D1',
    'Settlement': '#FFA07A',
    'Recovery': '#98D8C8',
    'Desktop Management': '#F7DC6F',
    'Claim Admin': '#BB8FCE',
    'Schedule Services': '#85C1E2',
    'Communication': '#F8B739',
    'Claim related teams chats': '#52B788',
    'END': '#E74C3C'
};

function initNetwork() {
    const container = document.getElementById('network-canvas');
    if (!container) {
        console.error('Network canvas container not found');
        setTimeout(initNetwork, 100);
        return;
    }
    
    width = container.clientWidth;
    height = container.clientHeight;
    
    // Create SVG
    svg = d3.select('#network-canvas')
        .append('svg')
        .attr('width', width)
        .attr('height', height);
    
    // Add zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
    
    svg.call(zoom);
    
    // Create main group
    g = svg.append('g');
    
    // Create tooltip
    tooltip = d3.select('body')
        .append('div')
        .attr('class', 'node-tooltip');
    
    // Initialize force simulation with top-to-bottom layout
    simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(180))
        .force('charge', d3.forceManyBody().strength(-500))
        .force('x', d3.forceX(width / 2).strength(0.1))
        .force('y', d3.forceY(d => 100 + d.depth * 200).strength(0.8))
        .force('collision', d3.forceCollide().radius(d => d.radius + 15))
        .on('tick', ticked);
    
    // Load initial data
    loadStartingProcesses();
}

async function loadStartingProcesses() {
    try {
        const response = await fetch('/api/starting-processes');
        const data = await response.json();
        
        // Position starting nodes in a row at the top
        const totalNodes = data.length;
        const spacing = Math.min(200, width / (totalNodes + 1));
        const startY = 100;
        
        currentNodes = data.map((proc, i) => ({
            id: `start_${proc.process}`,
            name: proc.process,
            count: proc.count,
            percentage: proc.percentage,
            depth: 0,
            path: [proc.process],
            isStarting: true,
            isTermination: false,
            radius: 30 + (proc.count / 114) * 25,
            x: (width / 2) - ((totalNodes - 1) * spacing / 2) + (i * spacing),
            y: startY,
            fx: null,
            fy: startY
        }));
        
        nodes = [...currentNodes];
        links = [];
        
        updateVisualization();
        updateBreadcrumb('Click on a node to explore');
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

async function expandNode(node) {
    if (node.isTermination) return;
    
    // Check if already expanded - if so, collapse it
    const hasChildren = links.some(l => l.source.id === node.id || l.source === node.id);
    
    if (hasChildren) {
        collapseNode(node);
        return;
    }
    
    try {
        let flowData;
        if (node.isStarting) {
            const response = await fetch(`/api/process-flow/${encodeURIComponent(node.name)}?filter_type=starting`);
            flowData = await response.json();
        } else {
            const pathStr = node.path.join(',');
            const response = await fetch(`/api/process-flow-after-path?path=${encodeURIComponent(pathStr)}`);
            flowData = await response.json();
        }
        
        const childDepth = node.depth + 1;
        
        // Calculate position for children - spread horizontally at the same depth
        const totalChildren = (flowData.next_steps?.length || 0) + (flowData.terminations?.count > 0 ? 1 : 0);
        const childY = 100 + childDepth * 200;
        
        // Add child nodes
        if (flowData.next_steps && flowData.next_steps.length > 0) {
            const maxCount = Math.max(...flowData.next_steps.map(s => s.count));
            
            flowData.next_steps.forEach((step, index) => {
                const childId = `${node.id}_${step.process}`;
                
                // Check if node already exists
                if (!nodes.find(n => n.id === childId)) {
                    const childNode = {
                        id: childId,
                        name: step.process,
                        count: step.count,
                        percentage: step.percentage,
                        depth: childDepth,
                        path: [...node.path, step.process],
                        parentId: node.id,
                        isTermination: false,
                        radius: 25 + (step.count / maxCount) * 30,
                        x: node.x + (index - (totalChildren - 1) / 2) * 150,
                        y: childY,
                        vy: 0
                    };
                    
                    nodes.push(childNode);
                    currentNodes.push(childNode);
                    
                    links.push({
                        source: node.id,
                        target: childId,
                        isTermination: false
                    });
                }
            });
        }
        
        // Add termination node
        if (flowData.terminations && flowData.terminations.count > 0) {
            const termId = `${node.id}_END`;
            
            if (!nodes.find(n => n.id === termId)) {
                const maxCountWithTerm = Math.max(
                    ...(flowData.next_steps?.map(s => s.count) || []),
                    flowData.terminations.count
                );
                
                const termNode = {
                    id: termId,
                    name: 'END',
                    count: flowData.terminations.count,
                    percentage: flowData.terminations.percentage,
                    depth: childDepth,
                    path: [...node.path, 'END'],
                    parentId: node.id,
                    isTermination: true,
                    radius: 25 + (flowData.terminations.count / maxCountWithTerm) * 30,
                    x: node.x + ((flowData.next_steps?.length || 0) - (totalChildren - 1) / 2) * 150,
                    y: childY,
                    vy: 0
                };
                
                nodes.push(termNode);
                currentNodes.push(termNode);
                
                links.push({
                    source: node.id,
                    target: termId,
                    isTermination: true
                });
            }
        }
        
        updateVisualization();
        updateBreadcrumb(node.path.join(' → '));
    } catch (error) {
        console.error('Error expanding node:', error);
    }
}

function collapseNode(node) {
    // Find all descendant nodes (children, grandchildren, etc.)
    const nodesToRemove = new Set();
    const linksToRemove = new Set();
    
    function findDescendants(parentId) {
        // Find direct children
        links.forEach((link, index) => {
            const sourceId = link.source.id || link.source;
            const targetId = link.target.id || link.target;
            
            if (sourceId === parentId) {
                linksToRemove.add(index);
                nodesToRemove.add(targetId);
                // Recursively find children of this child
                findDescendants(targetId);
            }
        });
    }
    
    findDescendants(node.id);
    
    // Remove links (in reverse order to maintain indices)
    const linksArray = Array.from(linksToRemove).sort((a, b) => b - a);
    linksArray.forEach(index => {
        links.splice(index, 1);
    });
    
    // Remove nodes
    nodes = nodes.filter(n => !nodesToRemove.has(n.id));
    currentNodes = currentNodes.filter(n => !nodesToRemove.has(n.id));
    
    updateVisualization();
    updateBreadcrumb(node.path.join(' → ') + ' (collapsed)');
}

function updateVisualization() {
    // Update links
    const link = g.selectAll('.link')
        .data(links, d => `${d.source.id || d.source}-${d.target.id || d.target}`);
    
    link.exit().remove();
    
    const linkEnter = link.enter()
        .append('line')
        .attr('class', 'link')
        .attr('stroke', d => d.isTermination ? '#E74C3C' : '#95A5A6')
        .attr('stroke-width', d => d.isTermination ? 3 : 2)
        .attr('opacity', 0.6);
    
    // Update nodes
    const node = g.selectAll('.node-group')
        .data(nodes, d => d.id);
    
    node.exit().remove();
    
    const nodeEnter = node.enter()
        .append('g')
        .attr('class', 'node-group')
        .call(d3.drag()
            .on('start', dragStarted)
            .on('drag', dragging)
            .on('end', dragEnded));
    
    // Add circles
    nodeEnter.append('circle')
        .attr('class', 'node-circle')
        .attr('r', d => d.radius)
        .attr('fill', d => COLORS[d.name] || '#95A5A6')
        .attr('stroke', d => d.isTermination ? '#C0392B' : 'white')
        .attr('stroke-width', 3)
        .style('cursor', d => d.isTermination ? 'default' : 'pointer')
        .on('click', (event, d) => {
            event.stopPropagation();
            expandNode(d);
        })
        .on('mouseover', (event, d) => showTooltip(event, d))
        .on('mousemove', (event, d) => moveTooltip(event))
        .on('mouseout', hideTooltip);
    
    // Add text inside circles
    nodeEnter.append('text')
        .attr('class', 'node-count')
        .attr('text-anchor', 'middle')
        .attr('dy', '.35em')
        .attr('fill', 'white')
        .attr('font-size', d => Math.max(12, d.radius / 2.5) + 'px')
        .attr('font-weight', 'bold')
        .attr('pointer-events', 'none')
        .text(d => d.count);
    
    // Add labels below
    nodeEnter.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('dy', d => d.radius + 18)
        .attr('fill', '#2C3E50')
        .attr('font-size', '11px')
        .attr('font-weight', '500')
        .attr('pointer-events', 'none')
        .text(d => d.name);
    
    // Add termination symbol
    nodeEnter.filter(d => d.isTermination)
        .append('text')
        .attr('class', 'termination-symbol')
        .attr('text-anchor', 'middle')
        .attr('dy', '.35em')
        .attr('fill', 'white')
        .attr('font-size', d => d.radius * 1.2 + 'px')
        .attr('font-weight', 'bold')
        .attr('pointer-events', 'none')
        .text('✕');
    
    // Update simulation
    simulation.nodes(nodes);
    simulation.force('link').links(links);
    simulation.alpha(0.3).restart();
}

function ticked() {
    g.selectAll('.link')
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    
    g.selectAll('.node-group')
        .attr('transform', d => `translate(${d.x},${d.y})`);
}

function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragging(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function showTooltip(event, d) {
    const pathStr = d.isTermination 
        ? d.path.slice(0, -1).join(' → ') + ' → END'
        : d.path.join(' → ');
    
    tooltip.html(`
        <div class="tooltip-title">${d.name}</div>
        <div class="tooltip-row">
            <span class="tooltip-label">Claims:</span>
            <span>${d.count}</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">Percentage:</span>
            <span>${d.percentage.toFixed(1)}%</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">Path:</span>
            <span>${pathStr}</span>
        </div>
        ${!d.isTermination ? '<div class="tooltip-hint">Click to expand</div>' : '<div class="tooltip-hint">Termination point</div>'}
    `)
    .classed('show', true);
    
    moveTooltip(event);
}

function moveTooltip(event) {
    tooltip
        .style('left', (event.pageX + 15) + 'px')
        .style('top', (event.pageY - 15) + 'px');
}

function hideTooltip() {
    tooltip.classed('show', false);
}

function updateBreadcrumb(text) {
    const breadcrumbEl = document.getElementById('breadcrumb-text');
    if (breadcrumbEl) {
        breadcrumbEl.textContent = text;
    }
}

function resetVisualization() {
    nodes = [];
    links = [];
    currentNodes = [];
    
    g.selectAll('.link').remove();
    g.selectAll('.node-group').remove();
    
    loadStartingProcesses();
}

// Handle window resize
window.addEventListener('resize', () => {
    const container = document.getElementById('network-canvas');
    if (!container) return;
    
    width = container.clientWidth;
    height = container.clientHeight;
    
    svg.attr('width', width).attr('height', height);
    
    // Update force positions
    simulation.force('x', d3.forceX(width / 2).strength(0.1));
    simulation.force('y', d3.forceY(d => 100 + d.depth * 200).strength(0.8));
    simulation.alpha(0.3).restart();
});

// Initialize when DOM and D3 are ready
function waitForD3() {
    if (typeof d3 !== 'undefined') {
        initNetwork();
    } else {
        setTimeout(waitForD3, 100);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForD3);
} else {
    waitForD3();
}

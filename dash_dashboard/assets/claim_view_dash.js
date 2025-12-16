window.ClaimView = (function () {

    let viewMode = 'detailed'; // 'detailed' or 'aggregated'

    function init() {
        const searchBtn = document.getElementById('searchBtn');
        const claimInput = document.getElementById('claimInput');
        const resultsArea = document.getElementById('resultsArea');

        if (searchBtn) {
            searchBtn.onclick = searchClaim;
        }

        if (claimInput) {
            claimInput.onkeypress = function (event) {
                if (event.key === 'Enter') {
                    searchClaim();
                }
            };
        }

        loadClaimNumbers();

        // Check URL params
        const urlParams = new URLSearchParams(window.location.search);
        const claimFromUrl = urlParams.get('claim');

        if (claimFromUrl) {
            if (claimInput) {
                claimInput.value = claimFromUrl;
                setTimeout(searchClaim, 500);
            }
        }

        // Check for pending claim view from other tabs
        const pendingClaim = sessionStorage.getItem('pendingClaimView');
        if (pendingClaim) {
            sessionStorage.removeItem('pendingClaimView');
            if (claimInput) {
                claimInput.value = pendingClaim;
                // Small delay to ensure data is loaded if needed, though searchClaim fetches directly
                setTimeout(searchClaim, 100);
            }
        }
    }

    async function loadClaimNumbers() {
        try {
            const response = await fetch('/api/claim-numbers');
            if (!response.ok) throw new Error('Failed to load claim numbers');

            const data = await response.json();
            const datalist = document.getElementById('claimList');

            if (datalist) {
                datalist.innerHTML = ''; // Clear existing
                data.claim_numbers.forEach(claimNum => {
                    const option = document.createElement('option');
                    option.value = claimNum;
                    datalist.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error loading claim numbers:', error);
        }
    }

    function toggleViewMode() {
        viewMode = viewMode === 'detailed' ? 'aggregated' : 'detailed';
        const btn = document.getElementById('claim-view-mode-btn');
        if (btn) {
            btn.className = viewMode === 'detailed' ? 'view-mode-btn detailed' : 'view-mode-btn aggregated';
            btn.innerHTML = viewMode === 'detailed' ? '👁️ Show Phases' : '🔍 Show Details';
        }
        // Re-fetch data if a claim is already loaded
        const claimInput = document.getElementById('claimInput');
        if (claimInput && claimInput.value.trim()) {
            searchClaim();
        }
    }

    async function searchClaim() {
        const claimInput = document.getElementById('claimInput');
        let claimNumber = claimInput.value.trim();
        const errorDiv = document.getElementById('errorMessage');
        const resultsArea = document.getElementById('resultsArea');
        const timeline = document.getElementById('timeline');

        // Reset UI
        if (errorDiv) errorDiv.style.display = 'none';
        if (resultsArea) resultsArea.style.display = 'none';
        if (timeline) timeline.innerHTML = '';

        if (!claimNumber) {
            showError('Please enter a claim number');
            return;
        }

        // Ensure claim number starts with "0"
        if (!claimNumber.startsWith('0')) {
            claimNumber = '0' + claimNumber;
        }

        try {
            const response = await fetch(`/api/claim-path/${claimNumber}?mode=${viewMode}`); if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Claim not found');
                }
                throw new Error('Failed to fetch claim data');
            }

            const data = await response.json();
            displayResults(data);

        } catch (error) {
            showError(error.message);
        }
    }

    function renderPhaseFlowDiagram(path) {
        const container = document.getElementById('process-analysis');
        if (!container) {
            console.error('Container process-analysis not found');
            return;
        }

        console.log('Rendering phase flow diagram with', path.length, 'steps');

        // Calculate process entries (times entering a process block), occurrences, transitions, and average durations
        const processEntries = {}; // Number of times we enter/start a process block
        const processOccurrences = {}; // Total number of steps in each process
        const processTotalDuration = {};
        const processStepCount = {}; // Total steps within each process
        const transitions = {};
        const transitionDurations = {}; // Track durations for each transition

        let currentProcess = null;
        let currentProcessStartIdx = 0;

        path.forEach((step, idx) => {
            const process = step.process;

            // Check if we're entering a new process block
            if (process !== currentProcess) {
                // We're entering a new process
                processEntries[process] = (processEntries[process] || 0) + 1;

                // Record transition if not the first step
                if (currentProcess !== null) {
                    const key = `${currentProcess}→${process}`;
                    transitions[key] = (transitions[key] || 0) + 1;

                    // Calculate duration of the source process block that led to this transition
                    let blockDuration = 0;
                    for (let i = currentProcessStartIdx; i < idx; i++) {
                        blockDuration += path[i].active_minutes;
                    }

                    // Store duration for this transition
                    if (!transitionDurations[key]) {
                        transitionDurations[key] = [];
                    }
                    transitionDurations[key].push(blockDuration);
                }

                currentProcess = process;
                currentProcessStartIdx = idx;
            }

            // Count all occurrences (all steps)
            processOccurrences[process] = (processOccurrences[process] || 0) + 1;

            // Count all steps for duration calculation
            processStepCount[process] = (processStepCount[process] || 0) + 1;
            processTotalDuration[process] = (processTotalDuration[process] || 0) + step.active_minutes;
        });

        // Calculate average duration per process (per step)
        const processAvgDuration = {};
        Object.keys(processStepCount).forEach(proc => {
            processAvgDuration[proc] = processTotalDuration[proc] / processStepCount[proc];
        });

        // Calculate average duration for each transition
        const transitionAvgDuration = {};
        Object.entries(transitionDurations).forEach(([key, durations]) => {
            transitionAvgDuration[key] = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        });

        console.log('Process entries (for flow counting):', processEntries);
        console.log('Process occurrences (total steps):', processOccurrences);
        console.log('Process step counts:', processStepCount);
        console.log('Process average durations:', processAvgDuration);
        console.log('Transitions:', transitions);
        console.log('Transition average durations:', transitionAvgDuration);

        // Prepare data - use processEntries as it represents the separate blocks
        const processes = Object.keys(processEntries);
        if (processes.length === 0) {
            container.innerHTML = '<h4 style="color:#666; margin-bottom:15px;">Phase Flow Diagram</h4><p style="color:#999;">No phase data to display.</p>';
            return;
        }

        // Create phase timeline visualization
        const processColors = {};
        const colorPalette = ['#f59e0b', '#ef4444', '#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#ec4899', '#f97316'];
        const processSequence = [];
        let colorIndex = 0;

        // Build sequential process list with durations
        path.forEach(step => {
            const proc = step.process || 'Unknown';
            if (!processColors[proc]) {
                processColors[proc] = colorPalette[colorIndex % colorPalette.length];
                colorIndex++;
            }
            // Check if this is a new process segment
            if (processSequence.length === 0 || processSequence[processSequence.length - 1].name !== proc) {
                processSequence.push({ name: proc, color: processColors[proc], duration: step.active_minutes });
            } else {
                processSequence[processSequence.length - 1].duration += step.active_minutes;
            }
        });

        const totalDuration = processSequence.reduce((sum, p) => sum + p.duration, 0);

        // Get unique processes for legend
        const uniqueProcesses = {};
        processSequence.forEach(proc => {
            if (!uniqueProcesses[proc.name]) {
                uniqueProcesses[proc.name] = proc.color;
            }
        });

        // Create phase timeline HTML with single line and legend
        let timelineHtml = `
            <div style="background:white; border-radius:12px; padding:20px; margin-bottom:20px; border:1px solid #e0e0e0; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
                <h3 style="color:#1A1446; margin:0 0 20px 0; font-size:1.2em; font-weight:700;">Phase Timeline</h3>
                
                <!-- Single line timeline with start arrow -->
                <div style="display:flex; align-items:center; margin-bottom:20px;">
                    <span style="font-size:1.5em; margin-right:10px; color:#1A1446;">▶</span>
                    <div style="flex:1; display:flex; height:40px; border-radius:6px; overflow:hidden; box-shadow:0 2px 4px rgba(0,0,0,0.15);">
                        ${processSequence.map((proc, index) => {
            const widthPct = totalDuration > 0 ? (proc.duration / totalDuration * 100) : (100 / processSequence.length);
            return `
                                <div style="
                                    width:${widthPct}%;
                                    background:${proc.color};
                                    display:flex;
                                    align-items:center;
                                    justify-content:center;
                                    color:white;
                                    font-size:0.75em;
                                    font-weight:600;
                                    position:relative;
                                    border-right:${index < processSequence.length - 1 ? '1px solid rgba(255,255,255,0.3)' : 'none'};
                                " title="${proc.name} - ${proc.duration.toFixed(1)}m (${widthPct.toFixed(1)}%)">
                                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 4px;">${widthPct > 8 ? proc.name : ''}</span>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
                
                <!-- Legend -->
                <div style="display:flex; flex-wrap:wrap; gap:12px; justify-content:center; padding-top:12px; border-top:1px solid #e0e0e0;">
                    ${Object.entries(uniqueProcesses).map(([name, color]) => `
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div style="width:16px; height:16px; background:${color}; border-radius:3px; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
                            <span style="font-size:0.85em; color:#666; font-weight:500;">${name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Set the phase timeline first
        container.innerHTML = timelineHtml;

        // Create circular layout for Phase Flow Diagram
        const width = container.offsetWidth || 600;
        const height = Math.max(500, width * 0.75); // Dynamic height based on width
        const radius = Math.min(width, height) / 2 - 80; // Increased padding (was 60)

        // Append Phase Flow Diagram header
        const flowHeader = document.createElement('h4');
        flowHeader.style.color = '#666';
        flowHeader.style.marginBottom = '15px';
        flowHeader.style.fontSize = '14px';
        flowHeader.textContent = 'Phase Flow Diagram';
        container.appendChild(flowHeader);

        // Create SVG wrapper
        const svgWrapper = document.createElement('div');
        container.appendChild(svgWrapper);

        const svg = d3.select(svgWrapper)
            .append('svg')
            .attr('width', '100%')
            .attr('height', height)
            .attr('viewBox', `0 0 ${width} ${height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('background', 'linear-gradient(135deg, #f8f9fc 0%, #ffffff 100%)')
            .style('border-radius', '12px')
            .style('box-shadow', '0 4px 12px rgba(26, 20, 70, 0.08)');

        const defs = svg.append('defs');

        const g = svg.append('g')
            .attr('transform', `translate(${width / 2},${height / 2})`);

        // Add gradients for nodes
        const gradientGold = defs.append('linearGradient')
            .attr('id', 'gradient-gold')
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%');
        gradientGold.append('stop')
            .attr('offset', '0%')
            .style('stop-color', '#FFE566')
            .style('stop-opacity', 1);
        gradientGold.append('stop')
            .attr('offset', '100%')
            .style('stop-color', '#FFD000')
            .style('stop-opacity', 1);

        const gradientIndigo = defs.append('linearGradient')
            .attr('id', 'gradient-indigo')
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%');
        gradientIndigo.append('stop')
            .attr('offset', '0%')
            .style('stop-color', '#818cf8')
            .style('stop-opacity', 1);
        gradientIndigo.append('stop')
            .attr('offset', '100%')
            .style('stop-color', '#6366f1')
            .style('stop-opacity', 1);

        // Add arrow markers
        ['gray'].forEach(color => {
            defs.append('marker')
                .attr('id', `arrow-${color}`)
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 9)
                .attr('refY', 0)
                .attr('markerWidth', 8)
                .attr('markerHeight', 8)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M0,-5L10,0L0,5')
                .style('fill', '#64748b')
                .style('opacity', 0.6);
        });

        // Calculate angles for each process
        const processKeys = Object.keys(processEntries);
        const angleStep = (2 * Math.PI) / processKeys.length;
        const processPositions = {};

        processKeys.forEach((proc, i) => {
            const angle = i * angleStep - Math.PI / 2; // Start from top
            processPositions[proc] = {
                angle: angle,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                count: processEntries[proc], // Number of times we enter this process (separate blocks)
                isInvestigation: proc === 'Investigation'
            };
        });

        // Draw links (curved paths between nodes) with neutral color
        Object.entries(transitions).forEach(([key, value]) => {
            const [source, target] = key.split('→');
            if (!processPositions[source] || !processPositions[target]) return;

            const sourcePos = processPositions[source];
            const targetPos = processPositions[target];
            const linkColor = '#64748b'; // Neutral slate gray

            // Create curved path with arrows
            g.append('path')
                .datum({ source, target, value })
                .attr('d', () => {
                    const dx = targetPos.x - sourcePos.x;
                    const dy = targetPos.y - sourcePos.y;
                    const dr = Math.sqrt(dx * dx + dy * dy) * 0.9;
                    return `M${sourcePos.x},${sourcePos.y}A${dr},${dr} 0 0,1 ${targetPos.x},${targetPos.y}`;
                })
                .style('fill', 'none')
                .style('stroke', linkColor)
                .style('stroke-width', Math.max(2, Math.sqrt(value) * 2))
                .style('opacity', 0.3)
                .style('stroke-linecap', 'round')
                .attr('marker-end', 'url(#arrow-gray)')
                .attr('class', 'flow-link')
                .on('mouseover', function (event, d) {
                    d3.select(this)
                        .style('opacity', 0.7)
                        .style('stroke-width', Math.max(4, Math.sqrt(d.value) * 3));

                    const transitionKey = `${d.source}→${d.target}`;
                    const avgDuration = transitionAvgDuration[transitionKey] || 0;

                    // Debug log
                    console.log('Transition hover:', d.source, '→', d.target, 'Avg duration in source before transition:', avgDuration);

                    // Remove any existing tooltips first
                    d3.selectAll('.flow-tooltip').remove();

                    const tooltip = d3.select('body').append('div')
                        .attr('class', 'flow-tooltip')
                        .style('position', 'fixed')
                        .style('background', '#1A1446')
                        .style('color', 'white')
                        .style('padding', '10px 14px')
                        .style('border-radius', '8px')
                        .style('font-size', '13px')
                        .style('line-height', '1.6')
                        .style('pointer-events', 'none')
                        .style('z-index', '999999')
                        .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
                        .style('border', '2px solid #FFD000')
                        .style('max-width', '300px')
                        .html(`<strong style="font-size: 14px;">${d.source} → ${d.target}</strong><br/>Transitions: <strong style="color: #FFD000;">${d.value}</strong><br/>Avg time in ${d.source} before transition: <strong style="color: #FFD000;">${avgDuration.toFixed(2)} min</strong>`)
                        .style('left', (event.clientX + 15) + 'px')
                        .style('top', (event.clientY + 15) + 'px')
                        .style('opacity', 0)
                        .transition()
                        .duration(200)
                        .style('opacity', 1);
                })
                .on('mouseout', function (event, d) {
                    d3.select(this)
                        .style('opacity', 0.3)
                        .style('stroke-width', Math.max(2, Math.sqrt(d.value) * 2));
                    d3.selectAll('.flow-tooltip').remove();
                });
        });

        // Draw nodes
        const nodeGroups = g.selectAll('.process-node')
            .data(processKeys)
            .enter()
            .append('g')
            .attr('class', 'process-node')
            .attr('transform', d => `translate(${processPositions[d].x},${processPositions[d].y})`);

        // Node circles with size based on count (increased size)
        const maxCount = Math.max(...Object.values(processEntries));

        // Add subtle glow effect
        nodeGroups.append('circle')
            .attr('r', d => 22 + (processEntries[d] / maxCount) * 26)
            .style('fill', d => processPositions[d].isInvestigation ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 208, 0, 0.08)')
            .style('stroke', 'none');

        nodeGroups.append('circle')
            .attr('r', d => 20 + (processEntries[d] / maxCount) * 24)
            .style('fill', d => processPositions[d].isInvestigation ? 'url(#gradient-indigo)' : 'url(#gradient-gold)')
            .style('stroke', 'none')
            .style('cursor', 'pointer')
            .style('opacity', 0.6)
            .style('filter', 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))')
            .on('mouseover', function (event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', 24 + (processEntries[d] / maxCount) * 28)
                    .style('opacity', 0.9)
                    .style('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))');

                const tooltip = d3.select('body').append('div')
                    .attr('class', 'flow-tooltip')
                    .style('position', 'absolute')
                    .style('background', '#1A1446')
                    .style('color', 'white')
                    .style('padding', '8px 12px')
                    .style('border-radius', '6px')
                    .style('font-size', '12px')
                    .style('pointer-events', 'none')
                    .style('z-index', '1000')
                    .style('box-shadow', '0 2px 8px rgba(0,0,0,0.15)')
                    .html(`${d}<br/>Occurrences: <strong>${processEntries[d]}</strong>`)
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', function (event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', 20 + (processEntries[d] / maxCount) * 24)
                    .style('opacity', 0.6)
                    .style('filter', 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))');
                d3.selectAll('.flow-tooltip').remove();
            });

        // Node labels
        nodeGroups.append('text')
            .attr('dy', d => {
                const pos = processPositions[d];
                return pos.y < 0 ? -30 - (processEntries[d] / maxCount) * 26 : 35 + (processEntries[d] / maxCount) * 26;
            })
            .attr('text-anchor', 'middle')
            .style('font-size', '13px')
            .style('font-weight', '500')
            .style('fill', d => processPositions[d].isInvestigation ? '#6366f1' : '#1A1446')
            .style('pointer-events', 'none')
            .text(d => d);

        // Count labels inside circles
        nodeGroups.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .style('font-size', '13px')
            .style('font-weight', '600')
            .style('fill', 'white')
            .style('text-shadow', '0 1px 2px rgba(0,0,0,0.4)')
            .style('pointer-events', 'none')
            .text(d => processEntries[d]);

        console.log('Phase flow diagram rendered successfully');
    }

    function displayResults(data) {
        const resultsArea = document.getElementById('resultsArea');
        const timeline = document.getElementById('timeline');
        const processAnalysis = document.getElementById('process-analysis');
        const activityAnalysis = document.getElementById('activity-analysis');

        // Add View Mode Toggle if not exists
        if (!document.getElementById('claim-view-mode-btn')) {
            const statsDiv = resultsArea.querySelector('.stats-summary');
            if (statsDiv && statsDiv.parentNode) {
                const controlsDiv = document.createElement('div');
                controlsDiv.style.textAlign = 'right';
                controlsDiv.style.marginBottom = '10px';

                const viewBtn = document.createElement('button');
                viewBtn.id = 'claim-view-mode-btn';
                viewBtn.className = viewMode === 'detailed' ? 'view-mode-btn detailed' : 'view-mode-btn aggregated';
                viewBtn.innerHTML = viewMode === 'detailed' ? '👁️ Show Phases' : '🔍 Show Details';
                viewBtn.style.position = 'relative';
                viewBtn.style.top = 'auto';
                viewBtn.style.right = 'auto';
                viewBtn.onclick = toggleViewMode;

                controlsDiv.appendChild(viewBtn);
                statsDiv.parentNode.insertBefore(controlsDiv, statsDiv);
            }
        }

        // Update summary stats with deduplicated count
        // Deduplicate consecutive identical entries for accurate step count
        let deduplicatedCount = 0;
        let lastStep = null;
        data.path.forEach((step) => {
            if (!lastStep ||
                lastStep.timestamp !== step.timestamp ||
                lastStep.process !== step.process ||
                lastStep.activity !== step.activity) {
                deduplicatedCount++;
                lastStep = step;
            }
        });

        document.getElementById('totalSteps').textContent = deduplicatedCount;

        const totalMinutes = data.path.reduce((sum, step) => sum + step.active_minutes, 0);
        document.getElementById('totalDuration').textContent = `${totalMinutes.toFixed(2)}m`;

        // Calculate Investigation duration
        const investigationMinutes = data.path
            .filter(step => step.process === 'Investigation')
            .reduce((sum, step) => sum + step.active_minutes, 0);

        const investigationStat = document.getElementById('investigationStat');
        const investigationDuration = document.getElementById('investigationDuration');

        if (investigationMinutes > 0 && viewMode === 'aggregated') {
            investigationDuration.textContent = `${investigationMinutes.toFixed(2)}m`;
            investigationStat.style.display = 'block';
        } else {
            investigationStat.style.display = 'none';
        }

        if (data.path.length > 0) {
            const startDate = new Date(data.path[0].timestamp);
            document.getElementById('startDate').textContent = startDate.toLocaleDateString();

            const endDate = new Date(data.path[data.path.length - 1].timestamp);
            document.getElementById('endDate').textContent = endDate.toLocaleDateString();
        }

        // Find max duration for scaling bars
        const maxActivityDuration = Math.max(...data.path.map(step => step.active_minutes));

        // Group consecutive steps by process
        const groupedSteps = [];
        data.path.forEach(step => {
            if (groupedSteps.length === 0 || groupedSteps[groupedSteps.length - 1].process !== step.process) {
                groupedSteps.push({
                    process: step.process,
                    activities: [step],
                    totalDuration: step.active_minutes
                });
            } else {
                const lastGroup = groupedSteps[groupedSteps.length - 1];
                lastGroup.activities.push(step);
                lastGroup.totalDuration += step.active_minutes;
            }
        });

        // Merge consecutive identical activities within each process group
        groupedSteps.forEach(group => {
            const mergedActivities = [];
            group.activities.forEach(act => {
                if (mergedActivities.length === 0) {
                    mergedActivities.push({ ...act, count: 1 });
                } else {
                    const lastAct = mergedActivities[mergedActivities.length - 1];
                    const actName = act.activity || 'Activity';
                    const lastActName = lastAct.activity || 'Activity';

                    if (actName === lastActName) {
                        // Merge
                        lastAct.active_minutes += act.active_minutes;
                        lastAct.count += 1;
                        // Keep start timestamp of the first one
                    } else {
                        mergedActivities.push({ ...act, count: 1 });
                    }
                }
            });
            group.activities = mergedActivities;
        });

        // Find max process duration for scaling bars
        const maxProcessDuration = Math.max(...groupedSteps.map(g => g.totalDuration));

        // Build timeline
        timeline.innerHTML = ''; // Clear existing
        groupedSteps.forEach((group, index) => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.style.animationDelay = `${index * 0.1}s`;

            const processPercentage = maxProcessDuration > 0 ? (group.totalDuration / maxProcessDuration) * 100 : 0;

            // Special styling for Investigation phase
            const isInvestigation = group.process === 'Investigation';
            // Use 'background' to override gradients and !important to ensure specificity
            const processColorStyle = isInvestigation ? 'background: #6366f1 !important;' : '';
            const processTextStyle = isInvestigation ? 'color: #6366f1 !important; font-weight: bold;' : '';
            const markerStyle = isInvestigation ? 'background: #c7d2fe !important; border-color: #6366f1 !important;' : '';

            let activitiesHtml = '';
            group.activities.forEach(step => {
                const date = new Date(step.timestamp);
                const formattedDate = date.toLocaleString();

                const countBadge = step.count > 1 ? `<span style="background:#FFD000; color:#1A1446; padding:1px 5px; border-radius:8px; font-size:0.75em; margin-left:5px; font-weight:bold;">x${step.count}</span>` : '';

                // Special styling for Investigation activities
                const activityBarStyle = isInvestigation ? 'background: linear-gradient(90deg, #6366f1, #818cf8);' : '';
                const activityBorderStyle = isInvestigation ? 'border-left: 3px solid #6366f1;' : '';

                activitiesHtml += `
                    <div class="activity-item" style="${activityBorderStyle}">
                        <div class="activity-header">
                            <span class="activity-name">${step.activity || 'Activity'} ${countBadge}</span>
                            <span class="activity-date">📅 ${formattedDate}</span>
                        </div>
                        <div class="activity-stats">
                             <span class="duration-badge">⏱️ ${step.active_minutes.toFixed(2)} min</span>
                        </div>
                        <div class="duration-bar-container" title="Activity duration (${step.active_minutes.toFixed(2)} min) shown relative to the longest phase in this claim">
                            <div class="duration-bar" style="width: ${Math.min(100, (step.active_minutes / maxProcessDuration) * 100 * 1.5)}%; ${activityBarStyle}"></div>
                        </div>
                    </div>
                `;
            });

            // Add explanation text for the first item only
            const explanationHtml = index === 0 ? `
                <div style="font-size: 0.75em; color: #666; font-style: italic; margin-top: 4px; padding: 4px 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #FFD000;">
                    ℹ️ Progress bars show duration relative to the longest phase (hover for details)
                </div>
            ` : '';

            item.innerHTML = `
                <div class="timeline-marker" style="${markerStyle}"></div>
                <div class="timeline-content">
                    <div class="process-header-block">
                        <div class="process-info">
                            <div class="process-name" style="${processTextStyle}">${group.process}</div>
                            <div class="process-total-duration">Total: ${group.totalDuration.toFixed(2)} min</div>
                        </div>
                        <div class="process-duration-bar-container" title="Progress bar shows total time spent in this phase (${group.totalDuration.toFixed(2)} min) relative to the longest phase (${maxProcessDuration.toFixed(2)} min)">
                            <div class="process-duration-bar" style="width: ${processPercentage}%; ${processColorStyle}"></div>
                        </div>
                        ${explanationHtml}
                    </div>
                    <div class="activity-list">
                        ${activitiesHtml}
                    </div>
                </div>
            `;

            timeline.appendChild(item);
        });

        // Add hover tooltips for progress bars
        addProgressBarTooltips();

        // --- Right Side Analysis ---

        // 0. Phase Flow Diagram
        renderPhaseFlowDiagram(data.path);

        // 1. Process Level Aggregation
        const processStats = {};
        const processColors = {};
        const colorPalette = ['#f59e0b', '#ef4444', '#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#ec4899', '#f97316'];
        let colorIndex = 0;

        data.path.forEach(step => {
            const proc = step.process || 'Unknown';
            if (!processStats[proc]) {
                processStats[proc] = 0;
                processColors[proc] = colorPalette[colorIndex % colorPalette.length];
                colorIndex++;
            }
            processStats[proc] += step.active_minutes;
        });

        const sortedProcesses = Object.entries(processStats)
            .sort(([, a], [, b]) => b - a);

        const maxTotalProcessDuration = sortedProcesses.length > 0 ? sortedProcesses[0][1] : 1;

        let processHtml = '<h4 style="color:#666; margin-bottom:10px; margin-top:20px;">Total Duration by Phase</h4>';
        processHtml += '<div style="display:flex; flex-direction:column; gap:10px;">';

        sortedProcesses.forEach(([proc, dur]) => {
            const pct = (dur / maxTotalProcessDuration) * 100;
            const barColor = processColors[proc] || '#1A1446';
            const textColor = processColors[proc] || '#1A1446';

            processHtml += `
                <div style="display:flex; align-items:center; gap:10px; font-size:0.9em;">
                    <div style="width:220px; font-weight:600; color:${textColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${proc}">${proc}</div>
                    <div style="flex:1; background:#f0f0f0; height:8px; border-radius:4px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:4px;"></div>
                    </div>
                    <div style="width:60px; text-align:right; font-weight:bold; color:#666;">${dur.toFixed(1)}m</div>
                </div>
            `;
        });
        processHtml += '</div>';

        // Append to existing content (don't overwrite the phase flow diagram)
        if (processAnalysis) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = processHtml;
            processAnalysis.appendChild(tempDiv);
        }

        // 2. Activity Level Aggregation
        const activityStats = {};
        data.path.forEach(step => {
            const isFromInvestigation = step.process === 'Investigation';
            const name = step.activity || 'Unknown';
            const displayName = isFromInvestigation ? `Investigation: ${name}` : name;

            if (!activityStats[displayName]) {
                activityStats[displayName] = { duration: 0, isInvestigation: isFromInvestigation };
            }
            activityStats[displayName].duration += step.active_minutes;
        });

        const sortedActivities = Object.entries(activityStats)
            .sort(([, a], [, b]) => b.duration - a.duration)
            .slice(0, 10); // Top 10 activities

        const maxTotalActivityDuration = sortedActivities.length > 0 ? sortedActivities[0][1].duration : 1;

        let activityHtml = '<h4 style="color:#666; margin-bottom:10px; margin-top:20px;">Top Activities by Duration</h4>';
        activityHtml += '<div style="display:flex; flex-direction:column; gap:10px;">';

        sortedActivities.forEach(([act, data]) => {
            const dur = data.duration;
            const isInv = data.isInvestigation;
            const pct = (dur / maxTotalActivityDuration) * 100;
            const barColor = isInv ? '#6366f1' : '#1A1446';
            const textColor = isInv ? '#6366f1' : '#1A1446';

            activityHtml += `
                <div style="display:flex; align-items:center; gap:10px; font-size:0.9em;">
                    <div style="width:220px; font-weight:600; color:${textColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${act}">${act}</div>
                    <div style="flex:1; background:#f0f0f0; height:8px; border-radius:4px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:4px;"></div>
                    </div>
                    <div style="width:60px; text-align:right; font-weight:bold; color:#666;">${dur.toFixed(1)}m</div>
                </div>
            `;
        });
        activityHtml += '</div>';
        if (activityAnalysis) activityAnalysis.innerHTML = activityHtml;

        // 3. Claim Information Section (if available)
        if (data.claim_info) {
            renderClaimInfo(data.claim_info, data.exposures, data.path);
        }

        if (resultsArea) resultsArea.style.display = 'block';
    }

    function renderClaimInfo(info, exposures, path) {
        const claimInfoDiv = document.getElementById('claim-info-section');
        if (!claimInfoDiv) return;

        const createInfoCard = (title, items) => {
            const itemsHtml = items.map(item => {
                if (!item.value || item.value === 'N/A' || item.value === 'nan') return '';
                return `
                    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f0f0;">
                        <span style="color:#666; font-size:0.85em;">${item.label}</span>
                        <span style="color:#1A1446; font-weight:600; font-size:0.85em;">${item.value}</span>
                    </div>
                `;
            }).join('');

            if (!itemsHtml) return '';

            return `
                <div style="background:white; border-radius:8px; padding:12px; border:1px solid #e0e0e0; min-width:200px;">
                    <h4 style="color:#1A1446; margin:0 0 10px 0; font-size:0.9em; font-weight:700; border-bottom:2px solid #FFD000; padding-bottom:6px;">${title}</h4>
                    ${itemsHtml}
                </div>
            `;
        };

        const claimDetails = createInfoCard('Claim Details', [
            { label: 'Status', value: info.claim_status },
            { label: 'Segment', value: info.claim_segment },
            { label: 'Tier', value: info.claim_tier },
            { label: 'Reported', value: info.claim_reported_date },
            { label: 'Opened', value: info.claim_open_date },
            { label: 'Closed', value: info.claim_closed_date }
        ]);

        const lossDetails = createInfoCard('Loss Information', [
            { label: 'Loss Date', value: info.loss_date },
            { label: 'Loss Type', value: info.loss_type },
            { label: 'City', value: info.loss_city },
            { label: 'State', value: info.loss_state },
            { label: 'ZIP Code', value: info.loss_zip_code },
            { label: 'County', value: info.loss_county },
            { label: 'Cause Category', value: info.loss_cause_category },
            { label: 'Cause Type', value: info.loss_cause_type },
            { label: 'Category Type', value: info.loss_category_type },
            { label: 'Fault Rating', value: info.fault_rating },
            { label: 'CAT Indicator', value: info.cat_indicator },
            { label: 'CAT Code', value: info.cat_code },
            { label: 'Flag', value: info.flag_description }
        ]);

        const policyDetails = createInfoCard('Policy Information', [
            { label: 'Policy #', value: info.policy_number },
            { label: 'Status', value: info.policy_status },
            { label: 'State', value: info.policy_state },
            { label: 'Effective Date', value: info.policy_effective_date },
            { label: 'Expiration Date', value: info.policy_expiration_date },
            { label: 'Total Vehicles', value: info.policy_total_vehicles },
            { label: 'Total Properties', value: info.policy_total_properties },
            { label: 'New Policy', value: info.new_policy_indicator },
            { label: 'Brand', value: info.brand },
            { label: 'Product Line', value: info.product_line },
            { label: 'Agent ID', value: info.agent_id }
        ]);

        // Render exposures
        let exposuresHtml = '';
        if (exposures && exposures.length > 0) {
            exposuresHtml = exposures.map((exp, index) => {
                return `
                    <div style="background:white; border-radius:8px; padding:12px; border:1px solid #e0e0e0; min-width:200px;">
                        <h4 style="color:#1A1446; margin:0 0 10px 0; font-size:0.9em; font-weight:700; border-bottom:2px solid #FFD000; padding-bottom:6px;">
                            Exposure ${index + 1} ${exp.exposure_number !== 'N/A' ? '(' + exp.exposure_number + ')' : ''}
                        </h4>
                        ${[
                        { label: 'Coverage', value: exp.coverage_type },
                        { label: 'Sub-Type', value: exp.coverage_subtype },
                        { label: 'Status', value: exp.exposure_status },
                        { label: 'Tier', value: exp.exposure_tier },
                        { label: 'Claimant Type', value: exp.claimant_type },
                        { label: 'Party Type', value: exp.loss_party_type },
                        { label: 'Jurisdiction', value: exp.jurisdiction_state },
                        { label: 'Opened', value: exp.exposure_open_date.split('T')[0] },
                        { label: 'Closed', value: exp.exposure_closed_date !== 'N/A' ? exp.exposure_closed_date.split('T')[0] : 'N/A' },
                        { label: 'Salvage', value: exp.salvage_indicator },
                        { label: 'SUBRO', value: exp.subro_indicator },
                        { label: 'SIU', value: exp.siu_indicator }
                    ].filter(item => item.value && item.value !== 'N/A' && item.value !== 'nan').map(item => `
                            <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f0f0;">
                                <span style="color:#666; font-size:0.85em;">${item.label}</span>
                                <span style="color:#1A1446; font-weight:600; font-size:0.85em;">${item.value}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }).join('');
        }

        claimInfoDiv.innerHTML = `
            <div style="background:white; border-radius:12px; padding:20px; border:1px solid #e0e0e0; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h4 style="color:#1A1446; margin:0; font-size:1.1em; font-weight:700;">Claim Information</h4>
                    <div style="display:flex; gap:8px;">
                        <button onclick="window.ClaimView.viewFullClaimDetails()" style="background:#1A1446; color:#FFD000; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:0.85em; font-weight:600; display:flex; align-items:center; gap:6px;">
                            <span>📋</span> View Details
                        </button>
                        <button onclick="window.ClaimView.downloadClaimCSV()" style="background:#FFD000; color:#1A1446; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:0.85em; font-weight:600; display:flex; align-items:center; gap:6px;">
                            <span>📥</span> Download CSV
                        </button>
                    </div>
                </div>
                
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px; margin-bottom:16px;">
                    ${claimDetails}
                    ${lossDetails}
                    ${policyDetails}
                </div>
                
                ${exposures && exposures.length > 0 ? `
                    <div style="border-top:2px solid #f0f0f0; padding-top:16px; margin-top:16px;">
                        <h4 style="color:#1A1446; margin:0 0 12px 0; font-size:1em; font-weight:700;">
                            Exposures <span style="background:#1A1446; color:#FFD000; padding:2px 8px; border-radius:10px; font-size:0.8em; margin-left:8px;">${exposures.length}</span>
                        </h4>
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
                            ${exposuresHtml}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        // Store the data for popup and CSV download
        window.currentClaimData = { info, exposures, path };
    }

    function viewFullClaimDetails() {
        const data = window.currentClaimData;
        if (!data) return;

        const modal = document.createElement('div');
        modal.id = 'claim-details-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            border-radius: 12px;
            max-width: 1200px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        modalContent.innerHTML = `
            <div style="position:sticky; top:0; background:white; border-bottom:2px solid #e0e0e0; padding:20px; z-index:1;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h2 style="color:#1A1446; margin:0; font-size:1.5em;">Claim ${data.info.claim_number} - Complete Details</h2>
                    <button onclick="document.getElementById('claim-details-modal').remove()" style="background:#dc3545; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600;">
                        ✕ Close
                    </button>
                </div>
            </div>
            
            <div style="padding:20px;">
                ${generateFullClaimHTML(data.info, data.exposures)}
            </div>
        `;

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    function generateFullClaimHTML(info, exposures) {
        const sections = [];

        // Claim Details Section
        sections.push(`
            <div style="background:#f8f9fa; border-radius:8px; padding:16px; margin-bottom:16px;">
                <h3 style="color:#1A1446; margin:0 0 12px 0; border-bottom:2px solid #FFD000; padding-bottom:8px;">Claim Details</h3>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
                    ${createDetailRow('Claim Number', info.claim_number)}
                    ${createDetailRow('Status', info.claim_status)}
                    ${createDetailRow('Segment', info.claim_segment)}
                    ${createDetailRow('Tier', info.claim_tier)}
                    ${createDetailRow('Owner', info.claim_owner)}
                    ${createDetailRow('Reported Date', info.claim_reported_date)}
                    ${createDetailRow('Open Date', info.claim_open_date)}
                    ${createDetailRow('Closed Date', info.claim_closed_date)}
                </div>
            </div>
        `);

        // Loss Information Section
        sections.push(`
            <div style="background:#f8f9fa; border-radius:8px; padding:16px; margin-bottom:16px;">
                <h3 style="color:#1A1446; margin:0 0 12px 0; border-bottom:2px solid #FFD000; padding-bottom:8px;">Loss Information</h3>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
                    ${createDetailRow('Loss Date', info.loss_date)}
                    ${createDetailRow('Loss Type', info.loss_type)}
                    ${createDetailRow('Loss City', info.loss_city)}
                    ${createDetailRow('Loss State', info.loss_state)}
                    ${createDetailRow('ZIP Code', info.loss_zip_code)}
                    ${createDetailRow('County', info.loss_county)}
                    ${createDetailRow('Cause Category', info.loss_cause_category)}
                    ${createDetailRow('Cause Type', info.loss_cause_type)}
                    ${createDetailRow('Category Type', info.loss_category_type)}
                    ${createDetailRow('CAT Code', info.cat_code)}
                    ${createDetailRow('Flag Description', info.flag_description)}
                    ${createDetailRow('Fault Rating', info.fault_rating)}
                    ${createDetailRow('CAT Indicator', info.cat_indicator)}
                </div>
            </div>
        `);

        // Policy Information Section
        sections.push(`
            <div style="background:#f8f9fa; border-radius:8px; padding:16px; margin-bottom:16px;">
                <h3 style="color:#1A1446; margin:0 0 12px 0; border-bottom:2px solid #FFD000; padding-bottom:8px;">Policy Information</h3>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
                    ${createDetailRow('Policy Number', info.policy_number)}
                    ${createDetailRow('Policy State', info.policy_state)}
                    ${createDetailRow('Policy Status', info.policy_status)}
                    ${createDetailRow('Effective Date', info.policy_effective_date)}
                    ${createDetailRow('Expiration Date', info.policy_expiration_date)}
                    ${createDetailRow('Total Vehicles', info.policy_total_vehicles)}
                    ${createDetailRow('Total Properties', info.policy_total_properties)}
                    ${createDetailRow('New Policy', info.new_policy_indicator)}
                    ${createDetailRow('Brand', info.brand)}
                    ${createDetailRow('Product Line', info.product_line)}
                    ${createDetailRow('Agent ID', info.agent_id)}
                </div>
            </div>
        `);

        // Exposures Section
        if (exposures && exposures.length > 0) {
            const exposuresHTML = exposures.map((exp, index) => `
                <div style="background:white; border-radius:8px; padding:16px; border:1px solid #e0e0e0; margin-bottom:12px;">
                    <h4 style="color:#1A1446; margin:0 0 12px 0; border-bottom:2px solid #FFD000; padding-bottom:8px;">
                        Exposure ${index + 1} ${exp.exposure_number !== 'N/A' ? '(' + exp.exposure_number + ')' : ''}
                    </h4>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
                        ${createDetailRow('Exposure ID', exp.exposure_id)}
                        ${createDetailRow('Coverage Type', exp.coverage_type)}
                        ${createDetailRow('Coverage Sub-Type', exp.coverage_subtype)}
                        ${createDetailRow('Status', exp.exposure_status)}
                        ${createDetailRow('Tier', exp.exposure_tier)}
                        ${createDetailRow('Claimant Type', exp.claimant_type)}
                        ${createDetailRow('Loss Party Type', exp.loss_party_type)}
                        ${createDetailRow('Jurisdiction State', exp.jurisdiction_state)}
                        ${createDetailRow('Opened', exp.exposure_open_date.split('T')[0])}
                        ${createDetailRow('Closed', exp.exposure_closed_date !== 'N/A' ? exp.exposure_closed_date.split('T')[0] : 'N/A')}
                        ${createDetailRow('SUBRO Indicator', exp.subro_indicator)}
                        ${createDetailRow('SIU Indicator', exp.siu_indicator)}
                        ${createDetailRow('Salvage Indicator', exp.salvage_indicator)}
                    </div>
                </div>
            `).join('');

            sections.push(`
                <div style="background:#f8f9fa; border-radius:8px; padding:16px;">
                    <h3 style="color:#1A1446; margin:0 0 12px 0; border-bottom:2px solid #FFD000; padding-bottom:8px;">
                        Exposures <span style="background:#1A1446; color:#FFD000; padding:2px 8px; border-radius:10px; font-size:0.8em; margin-left:8px;">${exposures.length}</span>
                    </h3>
                    ${exposuresHTML}
                </div>
            `);
        }

        return sections.join('');
    }

    function createDetailRow(label, value) {
        if (!value || value === 'N/A' || value === 'nan') return '';
        return `
            <div style="background:white; padding:8px; border-radius:4px;">
                <div style="color:#666; font-size:0.8em; margin-bottom:4px;">${label}</div>
                <div style="color:#1A1446; font-weight:600;">${value}</div>
            </div>
        `;
    }

    function downloadClaimCSV() {
        const data = window.currentClaimData;
        if (!data || !data.path) return;

        const claimNumber = data.info.claim_number;
        const path = data.path;

        // Deduplicate consecutive identical entries
        const deduplicatedPath = [];
        path.forEach((step, index) => {
            // Check if this step is different from the previous one
            if (index === 0 ||
                deduplicatedPath[deduplicatedPath.length - 1].timestamp !== step.timestamp ||
                deduplicatedPath[deduplicatedPath.length - 1].process !== step.process ||
                deduplicatedPath[deduplicatedPath.length - 1].activity !== step.activity) {
                deduplicatedPath.push({
                    timestamp: step.timestamp,
                    process: step.process,
                    activity: step.activity,
                    active_minutes: step.active_minutes,
                    count: 1
                });
            } else {
                // Same as previous, aggregate the duration
                const last = deduplicatedPath[deduplicatedPath.length - 1];
                last.active_minutes += step.active_minutes;
                last.count += 1;
            }
        });

        // Create CSV header
        const headers = ['Step', 'Timestamp', 'Process', 'Activity', 'Duration (minutes)', 'Count'];

        // Create CSV rows
        const rows = deduplicatedPath.map((step, index) => [
            index + 1,
            step.timestamp,
            step.process || '',
            step.activity || '',
            step.active_minutes.toFixed(2),
            step.count
        ]);

        // Combine headers and rows
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `claim_${claimNumber}_steps.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function addProgressBarTooltips() {
        // Create a tooltip element if it doesn't exist
        let tooltip = document.getElementById('progress-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'progress-tooltip';
            tooltip.style.cssText = `
                position: fixed;
                background: rgba(26, 20, 70, 0.95);
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 12px;
                z-index: 10000;
                pointer-events: none;
                display: none;
                max-width: 300px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                border: 1px solid rgba(255, 208, 0, 0.3);
            `;
            document.body.appendChild(tooltip);
        }

        // Add event listeners to all progress bar containers
        const progressBars = document.querySelectorAll('.process-duration-bar-container, .duration-bar-container');

        progressBars.forEach(bar => {
            bar.addEventListener('mouseenter', function (e) {
                const tooltipText = this.getAttribute('title');
                if (tooltipText) {
                    tooltip.textContent = tooltipText;
                    tooltip.style.display = 'block';
                    // Remove the title attribute to prevent default tooltip
                    this.setAttribute('data-title', tooltipText);
                    this.removeAttribute('title');
                }
            });

            bar.addEventListener('mousemove', function (e) {
                if (tooltip.style.display === 'block') {
                    tooltip.style.left = (e.clientX + 10) + 'px';
                    tooltip.style.top = (e.clientY + 10) + 'px';
                }
            });

            bar.addEventListener('mouseleave', function () {
                tooltip.style.display = 'none';
                // Restore the title attribute
                const titleText = this.getAttribute('data-title');
                if (titleText) {
                    this.setAttribute('title', titleText);
                }
            });
        });
    }

    function showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    }

    return {
        init: init,
        viewFullClaimDetails: viewFullClaimDetails,
        downloadClaimCSV: downloadClaimCSV
    };

})();

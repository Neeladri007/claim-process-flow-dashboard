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
            const response = await fetch(`/api/claim-path/${claimNumber}?mode=${viewMode}`);

            if (!response.ok) {
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

        // Create circular layout
        const width = container.offsetWidth || 600;
        const height = Math.max(500, width * 0.75); // Dynamic height based on width
        const radius = Math.min(width, height) / 2 - 80; // Increased padding (was 60)

        container.innerHTML = '<h4 style="color:#666; margin-bottom:15px; font-size: 14px;">Phase Flow Diagram</h4>';

        const svg = d3.select(container)
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
        const angleStep = (2 * Math.PI) / processes.length;
        const processPositions = {};

        processes.forEach((proc, i) => {
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
            .data(processes)
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

        // Update summary stats
        document.getElementById('totalSteps').textContent = data.total_steps;

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
                        <div class="duration-bar-container" title="Duration">
                            <div class="duration-bar" style="width: ${Math.min(100, (step.active_minutes / maxProcessDuration) * 100 * 1.5)}%; ${activityBarStyle}"></div>
                        </div>
                    </div>
                `;
            });

            item.innerHTML = `
                <div class="timeline-marker" style="${markerStyle}"></div>
                <div class="timeline-content">
                    <div class="process-header-block">
                        <div class="process-info">
                            <div class="process-name" style="${processTextStyle}">${group.process}</div>
                            <div class="process-total-duration">Total: ${group.totalDuration.toFixed(2)} min</div>
                        </div>
                        <div class="process-duration-bar-container" title="Total process duration">
                            <div class="process-duration-bar" style="width: ${processPercentage}%; ${processColorStyle}"></div>
                        </div>
                    </div>
                    <div class="activity-list">
                        ${activitiesHtml}
                    </div>
                </div>
            `;

            timeline.appendChild(item);
        });

        // --- Right Side Analysis ---

        // 0. Phase Flow Diagram
        renderPhaseFlowDiagram(data.path);

        // 1. Process Level Aggregation
        const processStats = {};
        data.path.forEach(step => {
            if (!processStats[step.process]) {
                processStats[step.process] = 0;
            }
            processStats[step.process] += step.active_minutes;
        });

        const sortedProcesses = Object.entries(processStats)
            .sort(([, a], [, b]) => b - a);

        const maxTotalProcessDuration = sortedProcesses.length > 0 ? sortedProcesses[0][1] : 1;

        let processHtml = '<h4 style="color:#666; margin-bottom:10px; margin-top:20px;">Total Duration by Phase</h4>';
        processHtml += '<div style="display:flex; flex-direction:column; gap:10px;">';

        sortedProcesses.forEach(([proc, dur]) => {
            const pct = (dur / maxTotalProcessDuration) * 100;
            const isInv = proc === 'Investigation';
            const barColor = isInv ? '#6366f1' : '#FFD000';
            const textColor = isInv ? '#6366f1' : '#1A1446';

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

        if (resultsArea) resultsArea.style.display = 'block';
    }

    function showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    }

    return {
        init: init
    };

})();

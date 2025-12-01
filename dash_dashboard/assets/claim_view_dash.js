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
        const claimNumber = claimInput.value.trim();
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

        let processHtml = '<h4 style="color:#666; margin-bottom:10px;">Total Duration by Phase</h4>';
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
        if (processAnalysis) processAnalysis.innerHTML = processHtml;

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

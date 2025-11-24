window.ClaimView = (function () {

    function init() {
        const searchBtn = document.getElementById('searchBtn');
        const claimInput = document.getElementById('claimInput');

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
            const response = await fetch(`/api/claim-path/${claimNumber}`);

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

        // Update summary stats
        document.getElementById('totalSteps').textContent = data.total_steps;

        const totalMinutes = data.path.reduce((sum, step) => sum + step.active_minutes, 0);
        document.getElementById('totalDuration').textContent = `${totalMinutes.toFixed(2)}m`;

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

        // Find max process duration for scaling bars
        const maxProcessDuration = Math.max(...groupedSteps.map(g => g.totalDuration));

        // Build timeline
        groupedSteps.forEach((group, index) => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.style.animationDelay = `${index * 0.1}s`;

            const processPercentage = maxProcessDuration > 0 ? (group.totalDuration / maxProcessDuration) * 100 : 0;

            let activitiesHtml = '';
            group.activities.forEach(step => {
                const date = new Date(step.timestamp);
                const formattedDate = date.toLocaleString();
                const percentage = maxActivityDuration > 0 ? (step.active_minutes / maxActivityDuration) * 100 : 0;

                activitiesHtml += `
                    <div class="activity-item">
                        <div class="activity-header">
                            <span class="activity-name">${step.activity || 'Activity'}</span>
                            <span class="activity-date">📅 ${formattedDate}</span>
                        </div>
                        <div class="activity-stats">
                             <span class="duration-badge">⏱️ ${step.active_minutes.toFixed(2)} min</span>
                        </div>
                        <div class="duration-bar-container" title="Duration relative to longest activity">
                            <div class="duration-bar" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                `;
            });

            item.innerHTML = `
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                    <div class="process-header-block">
                        <div class="process-info">
                            <div class="process-name">${group.process}</div>
                            <div class="process-total-duration">Total: ${group.totalDuration.toFixed(2)} min</div>
                        </div>
                        <div class="process-duration-bar-container" title="Total process duration relative to longest process block">
                            <div class="process-duration-bar" style="width: ${processPercentage}%"></div>
                        </div>
                    </div>
                    <div class="activity-list">
                        ${activitiesHtml}
                    </div>
                </div>
            `;

            timeline.appendChild(item);
        });

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

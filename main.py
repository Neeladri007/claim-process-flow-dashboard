from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import pandas as pd
from typing import Dict, List, Optional
import os

app = FastAPI(title="Claim Process Flow Analyzer")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variable to store the dataframe
df = None
collapsed_df = None
activity_collapsed_df = None

def load_data():
    """Load the CSV data"""
    global df, collapsed_df, activity_collapsed_df
    csv_path = "simulated_claim_activities.csv"
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV file not found: {csv_path}")
    df = pd.read_csv(csv_path)
    df['First_TimeStamp'] = pd.to_datetime(df['First_TimeStamp'])
    
    # Create collapsed dataframe for process flow analysis
    # Sort by claim and timestamp
    df_sorted = df.sort_values(['Claim_Number', 'First_TimeStamp'])
    
    # Identify where the process changes for the same claim
    process_changed = (df_sorted['Process'] != df_sorted['Process'].shift(1))
    claim_changed = (df_sorted['Claim_Number'] != df_sorted['Claim_Number'].shift(1))
    
    # A new group starts if the process changes OR the claim changes
    group_key = (process_changed | claim_changed).cumsum()
    
    # Group by this key and aggregate
    collapsed_df = df_sorted.groupby(group_key).agg({
        'Claim_Number': 'first',
        'Process': 'first',
        'First_TimeStamp': 'first',
        'Active_Minutes': 'sum'
    }).reset_index(drop=True)
    
    # Create activity collapsed dataframe
    # Identify where the process OR activity changes
    activity_changed = (df_sorted['Activity'] != df_sorted['Activity'].shift(1))
    
    # A new group starts if process changes OR activity changes OR claim changes
    activity_group_key = (process_changed | activity_changed | claim_changed).cumsum()
    
    activity_collapsed_df = df_sorted.groupby(activity_group_key).agg({
        'Claim_Number': 'first',
        'Process': 'first',
        'Activity': 'first',
        'First_TimeStamp': 'first',
        'Active_Minutes': 'sum'
    }).reset_index(drop=True)
    
    # Create a combined "Node Name" for the tree
    # Handle potential missing activities
    activity_collapsed_df['Activity'] = activity_collapsed_df['Activity'].fillna('Unknown')
    activity_collapsed_df['Node_Name'] = activity_collapsed_df['Process'] + " | " + activity_collapsed_df['Activity']
    
    print(f"Loaded {len(df)} records from CSV")
    print(f"Collapsed into {len(collapsed_df)} process blocks")
    print(f"Collapsed into {len(activity_collapsed_df)} activity blocks")

@app.on_event("startup")
async def startup_event():
    """Load data on startup"""
    load_data()

@app.get("/")
async def root():
    """Serve the frontend HTML"""
    return FileResponse("index.html")

@app.get("/claim-view")
async def claim_view():
    """Serve the claim view HTML"""
    return FileResponse("claim_view.html")

@app.get("/claim_view.html")
async def claim_view_file():
    """Serve the claim view HTML file directly"""
    return FileResponse("claim_view.html")

@app.get("/index.html")
async def index_file():
    """Serve the index HTML file directly"""
    return FileResponse("index.html")

@app.get("/api/starting-processes")
async def get_starting_processes():
    """Get all starting processes with their claim counts and average duration"""
    if collapsed_df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Get the first process for each claim with activity data
    first_activities = collapsed_df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number').first()
    starting_processes = first_activities['Process']
    
    # Count occurrences and calculate average duration
    process_counts = starting_processes.value_counts().to_dict()
    total_claims = len(starting_processes)
    
    # Calculate average duration for each starting process
    process_durations = {}
    for process in process_counts.keys():
        # Get all first activities for this process
        mask = first_activities['Process'] == process
        avg_duration = first_activities[mask]['Active_Minutes'].mean()
        process_durations[process] = avg_duration
    
    # Format response
    result = []
    for process, count in process_counts.items():
        result.append({
            "process": process,
            "count": int(count),
            "percentage": round((count / total_claims) * 100, 2),
            "avg_duration_minutes": round(process_durations[process], 2)
        })
    
    # Sort by count descending
    result.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        "total_claims": total_claims,
        "starting_processes": result
    }

@app.get("/api/process-flow/{process_name}")
async def get_process_flow(process_name: str, filter_type: Optional[str] = None):
    """
    Get the flow data for a specific process - ONLY IMMEDIATE NEXT TRANSITIONS
    filter_type: 'starting' - only claims that started with this process
                 None - all claims that went through this process
    """
    if collapsed_df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Get claim sequences with activity data
    claim_data = collapsed_df.sort_values(['Claim_Number', 'First_TimeStamp'])
    claim_sequences = claim_data.groupby('Claim_Number')['Process'].apply(list).to_dict()
    
    # Filter claims based on filter_type and collect FIRST occurrence transitions
    transitions = []
    transition_durations = {}  # Store durations for each transition
    terminations = 0
    relevant_claims_count = 0
    
    for claim_num, processes in claim_sequences.items():
        if filter_type == 'starting':
            # Only claims that start with this process
            if processes and processes[0] == process_name:
                relevant_claims_count += 1
                # Get ONLY the immediate next step after the FIRST occurrence
                if len(processes) > 1:
                    next_process = processes[1]
                    transitions.append(next_process)
                    
                    # Get duration for this next process
                    claim_activities = claim_data[claim_data['Claim_Number'] == claim_num]
                    # Find the second activity (index 1) which is the next process
                    if len(claim_activities) > 1:
                        duration = claim_activities.iloc[1]['Active_Minutes']
                        if next_process not in transition_durations:
                            transition_durations[next_process] = []
                        transition_durations[next_process].append(duration)
                else:
                    terminations += 1
        else:
            # All claims that have this process - but only count FIRST occurrence
            if process_name in processes:
                relevant_claims_count += 1
                # Find FIRST occurrence and get immediate next step
                first_index = processes.index(process_name)
                if first_index < len(processes) - 1:
                    next_process = processes[first_index + 1]
                    transitions.append(next_process)
                    
                    # Get duration for this next process
                    claim_activities = claim_data[claim_data['Claim_Number'] == claim_num]
                    # Find the activity at first_index + 1
                    if len(claim_activities) > first_index + 1:
                        duration = claim_activities.iloc[first_index + 1]['Active_Minutes']
                        if next_process not in transition_durations:
                            transition_durations[next_process] = []
                        transition_durations[next_process].append(duration)
                else:
                    terminations += 1
    
    if relevant_claims_count == 0:
        return {
            "process": process_name,
            "filter_type": filter_type,
            "total_claims": 0,
            "next_steps": [],
            "terminations": {"count": 0, "percentage": 0}
        }
    
    # Count transitions
    from collections import Counter
    transition_counts = Counter(transitions)
    
    total_flows = len(transitions) + terminations
    
    # Format next steps with average duration
    next_steps = []
    for next_process, count in transition_counts.items():
        avg_duration = 0
        if next_process in transition_durations and transition_durations[next_process]:
            avg_duration = sum(transition_durations[next_process]) / len(transition_durations[next_process])
        
        next_steps.append({
            "process": next_process,
            "count": count,
            "percentage": round((count / total_flows) * 100, 2) if total_flows > 0 else 0,
            "avg_duration_minutes": round(avg_duration, 2)
        })
    
    # Sort by count descending
    next_steps.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        "process": process_name,
        "filter_type": filter_type,
        "total_claims": relevant_claims_count,
        "total_flows": total_flows,
        "next_steps": next_steps,
        "terminations": {
            "count": terminations,
            "percentage": round((terminations / total_flows) * 100, 2) if total_flows > 0 else 0
        }
    }

@app.get("/api/all-processes")
async def get_all_processes():
    """Get list of all unique processes"""
    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    processes = sorted(df['Process'].unique().tolist())
    return {"processes": processes}

@app.get("/api/process-flow-after-path")
async def get_process_flow_after_path(path: str):
    """
    Get the flow data after following a specific path FROM THE START
    path: comma-separated list of processes (e.g., "Total Loss,Claim Admin,Settlement")
    Returns the next steps after this exact sequence STARTING FROM THE BEGINNING
    """
    if collapsed_df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Parse the path
    process_path = [p.strip() for p in path.split(',')]
    if not process_path:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    # Get claim sequences with activity data
    claim_data = collapsed_df.sort_values(['Claim_Number', 'First_TimeStamp'])
    claim_sequences = claim_data.groupby('Claim_Number')['Process'].apply(list).to_dict()
    
    # Find claims that follow this exact path FROM THE START
    transitions = []
    transition_durations = {}  # Store durations for each transition
    terminations = 0
    matching_claims = 0
    
    path_len = len(process_path)
    
    for claim_num, processes in claim_sequences.items():
        # Check if this claim STARTS with this exact path
        if len(processes) >= path_len:
            # Check if the beginning of the sequence matches our path
            if processes[:path_len] == process_path:
                matching_claims += 1
                # Get the next step after this path
                if len(processes) > path_len:
                    next_process = processes[path_len]
                    transitions.append(next_process)
                    
                    # Get duration for this next process
                    claim_activities = claim_data[claim_data['Claim_Number'] == claim_num]
                    # Find the activity at path_len index
                    if len(claim_activities) > path_len:
                        duration = claim_activities.iloc[path_len]['Active_Minutes']
                        if next_process not in transition_durations:
                            transition_durations[next_process] = []
                        transition_durations[next_process].append(duration)
                else:
                    terminations += 1
    
    if matching_claims == 0:
        return {
            "path": process_path,
            "total_claims": 0,
            "total_flows": 0,
            "next_steps": [],
            "terminations": {"count": 0, "percentage": 0}
        }
    
    # Count transitions
    from collections import Counter
    transition_counts = Counter(transitions)
    
    total_flows = len(transitions) + terminations
    
    # Format next steps - THE COUNT HERE IS THE ACTUAL TRANSITION COUNT
    next_steps = []
    for next_process, count in transition_counts.items():
        avg_duration = 0
        if next_process in transition_durations and transition_durations[next_process]:
            avg_duration = sum(transition_durations[next_process]) / len(transition_durations[next_process])
        
        next_steps.append({
            "process": next_process,
            "count": count,  # This is how many claims transitioned here
            "percentage": round((count / total_flows) * 100, 2) if total_flows > 0 else 0,
            "avg_duration_minutes": round(avg_duration, 2)
        })
    
    # Sort by count descending
    next_steps.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        "path": process_path,
        "total_claims": matching_claims,  # Claims that followed this path from start
        "total_flows": total_flows,  # Should equal total_claims (transitions + terminations)
        "next_steps": next_steps,
        "terminations": {
            "count": terminations,
            "percentage": round((terminations / total_flows) * 100, 2) if total_flows > 0 else 0
        }
    }

@app.get("/api/claim-path/{claim_number}")
async def get_claim_path(claim_number: int):
    """Get the complete process path for a specific claim"""
    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    claim_data = df[df['Claim_Number'] == claim_number].sort_values('First_TimeStamp')
    
    if claim_data.empty:
        raise HTTPException(status_code=404, detail="Claim not found")
    
    path = []
    for _, row in claim_data.iterrows():
        path.append({
            "process": row['Process'],
            "activity": row['Activity'] if 'Activity' in row else None,
            "timestamp": row['First_TimeStamp'].isoformat(),
            "active_minutes": float(row['Active_Minutes'])
        })
    
    return {
        "claim_number": claim_number,
        "path": path,
        "total_steps": len(path)
    }

@app.get("/api/claim-numbers")
async def get_claim_numbers():
    """Get all unique claim numbers"""
    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    claim_numbers = sorted(df['Claim_Number'].unique().tolist())
    return {"claim_numbers": claim_numbers}

@app.get("/api/activity-flow/starting-nodes")
async def get_activity_starting_nodes():
    """Get all starting activity nodes with their claim counts and average duration"""
    if activity_collapsed_df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Get the first activity for each claim
    first_activities = activity_collapsed_df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number').first()
    starting_nodes = first_activities['Node_Name']
    
    # Count occurrences
    node_counts = starting_nodes.value_counts().to_dict()
    total_claims = len(starting_nodes)
    
    # Calculate average duration
    node_durations = {}
    for node in node_counts.keys():
        mask = first_activities['Node_Name'] == node
        avg_duration = first_activities[mask]['Active_Minutes'].mean()
        node_durations[node] = avg_duration
    
    # Format response
    result = []
    for node, count in node_counts.items():
        parts = node.split(' | ')
        process = parts[0]
        activity = parts[1] if len(parts) > 1 else ""
        
        result.append({
            "node_name": node,
            "process": process,
            "activity": activity,
            "count": int(count),
            "percentage": round((count / total_claims) * 100, 2),
            "avg_duration_minutes": round(node_durations[node], 2)
        })
    
    # Sort by count descending
    result.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        "total_claims": total_claims,
        "starting_nodes": result
    }

@app.get("/api/activity-flow/next-steps")
async def get_activity_next_steps(path: str):
    """
    Get the flow data after following a specific path of activities
    path: sequence of "Process | Activity" separated by ";;"
    """
    if activity_collapsed_df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Parse the path
    # Use ';;' as separator to avoid conflict with potential commas in names
    node_path = [p.strip() for p in path.split(';;')]
    if not node_path:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    # Get claim sequences
    claim_data = activity_collapsed_df.sort_values(['Claim_Number', 'First_TimeStamp'])
    claim_sequences = claim_data.groupby('Claim_Number')['Node_Name'].apply(list).to_dict()
    
    transitions = []
    transition_durations = {}
    terminations = 0
    matching_claims = 0
    
    path_len = len(node_path)
    
    for claim_num, nodes in claim_sequences.items():
        if len(nodes) >= path_len:
            if nodes[:path_len] == node_path:
                matching_claims += 1
                if len(nodes) > path_len:
                    next_node = nodes[path_len]
                    transitions.append(next_node)
                    
                    # Get duration
                    claim_activities = claim_data[claim_data['Claim_Number'] == claim_num]
                    if len(claim_activities) > path_len:
                        duration = claim_activities.iloc[path_len]['Active_Minutes']
                        if next_node not in transition_durations:
                            transition_durations[next_node] = []
                        transition_durations[next_node].append(duration)
                else:
                    terminations += 1
    
    if matching_claims == 0:
        return {
            "path": node_path,
            "total_claims": 0,
            "total_flows": 0,
            "next_steps": [],
            "terminations": {"count": 0, "percentage": 0}
        }
    
    from collections import Counter
    transition_counts = Counter(transitions)
    total_flows = len(transitions) + terminations
    
    next_steps = []
    for next_node, count in transition_counts.items():
        avg_duration = 0
        if next_node in transition_durations and transition_durations[next_node]:
            avg_duration = sum(transition_durations[next_node]) / len(transition_durations[next_node])
        
        parts = next_node.split(' | ')
        process = parts[0]
        activity = parts[1] if len(parts) > 1 else ""
        
        next_steps.append({
            "node_name": next_node,
            "process": process,
            "activity": activity,
            "count": count,
            "percentage": round((count / total_flows) * 100, 2) if total_flows > 0 else 0,
            "avg_duration_minutes": round(avg_duration, 2)
        })
    
    next_steps.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        "path": node_path,
        "total_claims": matching_claims,
        "total_flows": total_flows,
        "next_steps": next_steps,
        "terminations": {
            "count": terminations,
            "percentage": round((terminations / total_flows) * 100, 2) if total_flows > 0 else 0
        }
    }

@app.get("/api/activity-flow/sunburst")
async def get_activity_sunburst(max_depth: int = 8, min_count: int = 2):
    """
    Get hierarchical data for Sunburst chart.
    """
    if activity_collapsed_df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Get all sequences
    sequences = activity_collapsed_df.sort_values(['Claim_Number', 'First_TimeStamp']) \
        .groupby('Claim_Number')['Node_Name'].apply(list)
    
    # Build Trie
    root = {"name": "Start", "children": []}
    
    for seq in sequences:
        current_node = root
        # Limit depth
        path = seq[:max_depth]
        
        for i, step_name in enumerate(path):
            # Find or create child
            found = None
            if "children" not in current_node:
                current_node["children"] = []
                
            for child in current_node["children"]:
                if child["name"] == step_name:
                    found = child
                    break
            
            if not found:
                # Extract process for coloring
                parts = step_name.split(' | ')
                process = parts[0]
                
                found = {
                    "name": step_name, 
                    "process": process,
                    "children": []
                }
                current_node["children"].append(found)
            
            current_node = found
            
            # If this is the end of the sequence (or max depth), add value
            if i == len(path) - 1:
                if "value" not in current_node:
                    current_node["value"] = 0
                current_node["value"] += 1
    
    # Prune low frequency branches to keep visualization clean
    def prune_and_clean(node):
        if "children" in node and node["children"]:
            # Filter children
            # We need to calculate total value of children to know if we should prune?
            # Actually, simpler to just prune based on leaf values? 
            # No, we need to prune based on total flow through the node.
            # But we haven't calculated total flow yet (D3 does that).
            # Let's do a pre-pass to calculate total counts?
            # Or just rely on the fact that we built it top-down.
            pass
            
        # For now, let's just return the raw tree and let D3 handle it, 
        # or do a simple prune if the node is a leaf and value is small.
        pass

    # Let's do a simple recursive count to prune small branches
    def add_counts(node):
        count = node.get("value", 0)
        if "children" in node:
            for child in node["children"]:
                count += add_counts(child)
        node["total_count"] = count
        return count

    add_counts(root)

    def filter_nodes(node):
        if "children" in node:
            node["children"] = [c for c in node["children"] if c["total_count"] >= min_count]
            for child in node["children"]:
                filter_nodes(child)
                
    filter_nodes(root)
    
    return root
    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

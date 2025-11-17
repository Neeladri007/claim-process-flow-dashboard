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

def load_data():
    """Load the CSV data"""
    global df
    csv_path = "simulated_claim_activities.csv"
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV file not found: {csv_path}")
    df = pd.read_csv(csv_path)
    df['First_TimeStamp'] = pd.to_datetime(df['First_TimeStamp'])
    print(f"Loaded {len(df)} records from CSV")

@app.on_event("startup")
async def startup_event():
    """Load data on startup"""
    load_data()

@app.get("/")
async def root():
    """Serve the frontend HTML"""
    return FileResponse("index.html")

@app.get("/api/starting-processes")
async def get_starting_processes():
    """Get all starting processes with their claim counts"""
    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Get the first process for each claim
    starting_processes = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number').first()['Process']
    
    # Count occurrences
    process_counts = starting_processes.value_counts().to_dict()
    total_claims = len(starting_processes)
    
    # Format response
    result = []
    for process, count in process_counts.items():
        result.append({
            "process": process,
            "count": int(count),
            "percentage": round((count / total_claims) * 100, 2)
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
    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Get claim sequences
    claim_sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].apply(list).to_dict()
    
    # Filter claims based on filter_type and collect FIRST occurrence transitions
    transitions = []
    terminations = 0
    relevant_claims_count = 0
    
    for claim_num, processes in claim_sequences.items():
        if filter_type == 'starting':
            # Only claims that start with this process
            if processes and processes[0] == process_name:
                relevant_claims_count += 1
                # Get ONLY the immediate next step after the FIRST occurrence
                if len(processes) > 1:
                    transitions.append(processes[1])
                else:
                    terminations += 1
        else:
            # All claims that have this process - but only count FIRST occurrence
            if process_name in processes:
                relevant_claims_count += 1
                # Find FIRST occurrence and get immediate next step
                first_index = processes.index(process_name)
                if first_index < len(processes) - 1:
                    transitions.append(processes[first_index + 1])
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
    
    # Format next steps
    next_steps = []
    for next_process, count in transition_counts.items():
        next_steps.append({
            "process": next_process,
            "count": count,
            "percentage": round((count / total_flows) * 100, 2) if total_flows > 0 else 0
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
    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")
    
    # Parse the path
    process_path = [p.strip() for p in path.split(',')]
    if not process_path:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    # Get claim sequences
    claim_sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].apply(list).to_dict()
    
    # Find claims that follow this exact path FROM THE START
    transitions = []
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
                    transitions.append(processes[path_len])
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
        next_steps.append({
            "process": next_process,
            "count": count,  # This is how many claims transitioned here
            "percentage": round((count / total_flows) * 100, 2) if total_flows > 0 else 0
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
            "timestamp": row['First_TimeStamp'].isoformat(),
            "active_minutes": float(row['Active_Minutes'])
        })
    
    return {
        "claim_number": claim_number,
        "path": path,
        "total_steps": len(path)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

import dash
from dash import html, dcc, Input, Output, State, clientside_callback
import pandas as pd
import os
import json
from flask import Flask, jsonify, request
import numpy as np
import base64
import io

# Initialize Flask server
server = Flask(__name__)

# External scripts for D3.js and d3-sankey
external_scripts = [
    'https://d3js.org/d3.v7.min.js',
    'https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js'
]

# Initialize Dash app
app = dash.Dash(__name__, server=server, title="WEA Claim Process Flow", suppress_callback_exceptions=True, external_scripts=external_scripts)

# Load Data
APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_DIR, "data")

# Global variables
df = None
collapsed_df = None
activity_collapsed_df = None
aggregated_collapsed_df = None
current_data_file = None
data_summary = {}

MAIN_PHASES = ['Coverage', 'Liability', 'Recovery', 'Schedule Services', 'Settlement', 'Total Loss']

def get_latest_csv():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    
    files = [os.path.join(DATA_DIR, f) for f in os.listdir(DATA_DIR) if f.endswith('.csv')]
    if not files:
        return None
    
    latest_file = max(files, key=os.path.getmtime)
    return latest_file

def process_dataframe(dataframe):
    global df, collapsed_df, activity_collapsed_df, data_summary
    df = dataframe
    
    # Convert Claim_Number to string to preserve leading zeros
    df['Claim_Number'] = df['Claim_Number'].astype(str)
    df['First_TimeStamp'] = pd.to_datetime(df['First_TimeStamp'])
    
    # Calculate summary statistics
    data_summary = {
        'total_claims': len(df['Claim_Number'].unique()),
        'min_timestamp': df['First_TimeStamp'].min().strftime('%Y-%m-%d'),
        'max_timestamp': df['First_TimeStamp'].max().strftime('%Y-%m-%d')
    }
    
    # Create collapsed dataframe for process flow analysis
    df_sorted = df.sort_values(['Claim_Number', 'First_TimeStamp'])
    process_changed = (df_sorted['Process'] != df_sorted['Process'].shift(1))
    claim_changed = (df_sorted['Claim_Number'] != df_sorted['Claim_Number'].shift(1))
    group_key = (process_changed | claim_changed).cumsum()
    
    collapsed_df = df_sorted.groupby(group_key).agg({
        'Claim_Number': 'first',
        'Process': 'first',
        'First_TimeStamp': 'first',
        'Active_Minutes': 'sum'
    }).reset_index(drop=True)
    
    # Create activity collapsed dataframe
    activity_changed = (df_sorted['Activity'] != df_sorted['Activity'].shift(1))
    activity_group_key = (process_changed | activity_changed | claim_changed).cumsum()
    
    activity_collapsed_df = df_sorted.groupby(activity_group_key).agg({
        'Claim_Number': 'first',
        'Process': 'first',
        'Activity': 'first',
        'First_TimeStamp': 'first',
        'Active_Minutes': 'sum'
    }).reset_index(drop=True)
    
    activity_collapsed_df['Activity'] = activity_collapsed_df['Activity'].fillna('Unknown')
    activity_collapsed_df['Node_Name'] = activity_collapsed_df['Process'] + " | " + activity_collapsed_df['Activity']
    
    # Create aggregated dataframe
    process_aggregated_dataframe(df)
    
    print(f"Loaded {len(df)} records")

def process_aggregated_dataframe(dataframe):
    global aggregated_collapsed_df, df
    
    temp_df = dataframe.copy()
    temp_df = temp_df.sort_values(['Claim_Number', 'First_TimeStamp'])
    
    def transform_func(process_series):
        processes = process_series.tolist()
        new_processes = []
        
        # Find first main phase
        first_main_idx = -1
        for i, p in enumerate(processes):
            if p in MAIN_PHASES:
                first_main_idx = i
                break
        
        # Scenario B: If no main phases found, label everything as Investigation
        if first_main_idx == -1:
            return ['Investigation'] * len(processes)
            
        # Scenario A: Label the initial steps before first main phase as Investigation
        for i in range(len(processes)):
            if i < first_main_idx:
                new_processes.append('Investigation')
            else:
                current_p = processes[i]
                if current_p in MAIN_PHASES:
                    new_processes.append(current_p)
                else:
                    # Scenario C: Interstitial Activities -> Merged into Next Main Phase
                    # Look ahead for the next main phase
                    next_main = None
                    for j in range(i + 1, len(processes)):
                        if processes[j] in MAIN_PHASES:
                            next_main = processes[j]
                            break
                    
                    if next_main:
                        new_processes.append(next_main)
                    else:
                        # If no next main phase, keep original
                        new_processes.append(current_p)
                    
        return new_processes

    temp_df['Aggregated_Process'] = temp_df.groupby('Claim_Number')['Process'].transform(transform_func)
    
    # Collapse aggregated
    process_changed = (temp_df['Aggregated_Process'] != temp_df['Aggregated_Process'].shift(1))
    claim_changed = (temp_df['Claim_Number'] != temp_df['Claim_Number'].shift(1))
    group_key = (process_changed | claim_changed).cumsum()
    
    aggregated_collapsed_df = temp_df.groupby(group_key).agg({
        'Claim_Number': 'first',
        'Aggregated_Process': 'first',
        'First_TimeStamp': 'first',
        'Active_Minutes': 'sum'
    }).reset_index(drop=True)
    
    # Rename for compatibility
    aggregated_collapsed_df['Process'] = aggregated_collapsed_df['Aggregated_Process']
    
    # Add Aggregated_Process to main df for Claim View
    if dataframe is not None:
        # Ensure dataframe has First_TimeStamp as datetime
        dataframe['First_TimeStamp'] = pd.to_datetime(dataframe['First_TimeStamp'])
        
        # Merge to add Aggregated_Process column
        df = dataframe.merge(
            temp_df[['Claim_Number', 'First_TimeStamp', 'Aggregated_Process']],
            on=['Claim_Number', 'First_TimeStamp'],
            how='left',
            suffixes=('', '_agg')
        )
        
        # Fill NaN with original Process
        df['Aggregated_Process'] = df['Aggregated_Process'].fillna(df['Process'])

    print("Aggregated dataframe created.")

def load_data(filename=None):
    global current_data_file
    
    if filename:
        csv_path = os.path.join(DATA_DIR, filename)
        if not os.path.exists(csv_path):
            print(f"File not found: {csv_path}")
            return False
    else:
        csv_path = get_latest_csv()
    
    if not csv_path:
        print(f"No CSV file found in: {DATA_DIR}")
        return False

    print(f"Loading data from {csv_path}...")
    temp_df = pd.read_csv(csv_path, dtype={'Claim_Number': str})
    process_dataframe(temp_df)
    current_data_file = os.path.basename(csv_path)
    return True

load_data()

# --- API Routes ---

@server.route('/api/starting-processes')
def get_starting_processes():
    mode = request.args.get('mode', 'detailed')
    target_df = aggregated_collapsed_df if mode == 'aggregated' else collapsed_df
    
    if target_df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    # Get total claims for percentage calculations
    total_claims_count = len(target_df['Claim_Number'].unique())
        
    # Get the first process for each claim
    starting_processes = target_df.sort_values('First_TimeStamp').groupby('Claim_Number').first().reset_index()
    
    # Count occurrences
    process_counts = starting_processes['Process'].value_counts().reset_index()
    process_counts.columns = ['process', 'count']
    
    total_claims = len(starting_processes)
    process_counts['percentage'] = (process_counts['count'] / total_claims * 100).round(1)
    process_counts['percentage_of_total'] = (process_counts['count'] / total_claims_count * 100).round(1)
    
    # Calculate average duration (Active_Minutes)
    avg_durations = starting_processes.groupby('Process')['Active_Minutes'].mean().round(1).reset_index()
    avg_durations.columns = ['process', 'avg_duration']
    
    # Calculate median duration
    median_durations = starting_processes.groupby('Process')['Active_Minutes'].median().round(1).reset_index()
    median_durations.columns = ['process', 'median_duration']
    
    # Calculate max duration
    max_durations = starting_processes.groupby('Process')['Active_Minutes'].max().round(1).reset_index()
    max_durations.columns = ['process', 'max_duration']
    
    # Calculate std duration
    std_durations = starting_processes.groupby('Process')['Active_Minutes'].std().round(1).reset_index()
    std_durations.columns = ['process', 'std_duration']
    
    # Merge
    result = pd.merge(process_counts, avg_durations, on='process')
    result = pd.merge(result, median_durations, on='process')
    result = pd.merge(result, max_durations, on='process')
    result = pd.merge(result, std_durations, on='process')
    result['std_duration'] = result['std_duration'].fillna(0)
    
    return jsonify({
        "total_claims": total_claims,
        "starting_processes": result.to_dict(orient='records')
    })

@server.route('/api/process-flow/<path:process_name>')
def get_process_flow(process_name):
    filter_type = request.args.get('filter_type', 'all')
    mode = request.args.get('mode', 'detailed')
    target_df = aggregated_collapsed_df if mode == 'aggregated' else collapsed_df
    
    if target_df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    if filter_type == 'starting':
        # Find claims that START with this process
        starting_claims = target_df.sort_values('First_TimeStamp').groupby('Claim_Number').first()
        claim_ids = starting_claims[starting_claims['Process'] == process_name].index.tolist()
        
        # Filter main df for these claims
        filtered_df = target_df[target_df['Claim_Number'].isin(claim_ids)].copy()
        
        # We need to find what comes AFTER the first process for these claims
        # Get the sequence for each claim
        filtered_df['seq'] = filtered_df.groupby('Claim_Number').cumcount()
        
        # We are looking for seq=1 (the step after seq=0 which is the starting process)
        next_steps_df = filtered_df[filtered_df['seq'] == 1]
        
        # Count next steps
        next_step_counts = next_steps_df['Process'].value_counts().reset_index()
        next_step_counts.columns = ['process', 'count']
        
        # Calculate terminations (claims with only 1 step)
        continuing_claims = next_steps_df['Claim_Number'].unique()
        terminations = len(claim_ids) - len(continuing_claims)
        
        total_flow = len(claim_ids)
        total_claims_in_data = len(target_df['Claim_Number'].unique())
        
        next_step_counts['percentage'] = (next_step_counts['count'] / total_flow * 100).round(1)
        next_step_counts['percentage_of_total'] = (next_step_counts['count'] / total_claims_in_data * 100).round(1)
        
        # Avg duration of the NEXT step
        avg_durations = next_steps_df.groupby('Process')['Active_Minutes'].mean().round(1).reset_index()
        avg_durations.columns = ['process', 'avg_duration']
        
        # Median duration
        median_durations = next_steps_df.groupby('Process')['Active_Minutes'].median().round(1).reset_index()
        median_durations.columns = ['process', 'median_duration']
        
        # Max duration
        max_durations = next_steps_df.groupby('Process')['Active_Minutes'].max().round(1).reset_index()
        max_durations.columns = ['process', 'max_duration']
        
        # Std duration
        std_durations = next_steps_df.groupby('Process')['Active_Minutes'].std().round(1).reset_index()
        std_durations.columns = ['process', 'std_duration']
        
        # Calculate cumulative time stats (time from start to end of this step)
        # We need to calculate cumulative time for each claim up to this step
        # Since we filtered for seq=1, we can just sum the first two steps for these claims
        
        # Get the full path for these claims (seq 0 and 1)
        path_df = filtered_df[filtered_df['seq'] <= 1].copy()
        cumulative_times = path_df.groupby('Claim_Number')['Active_Minutes'].sum().reset_index()
        cumulative_times.columns = ['Claim_Number', 'cumulative_time']
        
        # Join back to next_steps_df to group by process
        next_steps_with_cum = pd.merge(next_steps_df, cumulative_times, on='Claim_Number')
        
        cum_mean = next_steps_with_cum.groupby('Process')['cumulative_time'].mean().round(1).reset_index()
        cum_mean.columns = ['process', 'mean_cumulative_time']
        
        cum_median = next_steps_with_cum.groupby('Process')['cumulative_time'].median().round(1).reset_index()
        cum_median.columns = ['process', 'median_cumulative_time']
        
        # Calculate remaining steps (avg)
        # For each claim, count total steps and subtract current step index (1)
        # We need the total count for each claim
        claim_total_steps = target_df[target_df['Claim_Number'].isin(continuing_claims)].groupby('Claim_Number').size().reset_index(name='total_steps')
        
        # Join with next_steps_df
        next_steps_with_total = pd.merge(next_steps_df, claim_total_steps, on='Claim_Number')
        next_steps_with_total['remaining_steps'] = next_steps_with_total['total_steps'] - 2 # -2 because 0-indexed and we are at step 1 (so 2 steps done)
        
        avg_remaining = next_steps_with_total.groupby('Process')['remaining_steps'].mean().round(1).reset_index()
        avg_remaining.columns = ['process', 'avg_remaining_steps']

        result_df = pd.merge(next_step_counts, avg_durations, on='process')
        result_df = pd.merge(result_df, median_durations, on='process')
        result_df = pd.merge(result_df, max_durations, on='process')
        result_df = pd.merge(result_df, std_durations, on='process')
        result_df = pd.merge(result_df, cum_mean, on='process')
        result_df = pd.merge(result_df, cum_median, on='process')
        result_df = pd.merge(result_df, avg_remaining, on='process', how='left')
        result_df['avg_remaining_steps'] = result_df['avg_remaining_steps'].fillna(0)
        result_df['std_duration'] = result_df['std_duration'].fillna(0)
        
        return jsonify({
            "source_process": process_name,
            "total_flow": total_flow,
            "terminations": {
                "count": terminations,
                "percentage": round(terminations / total_flow * 100, 1)
            },
            "next_steps": result_df.to_dict(orient='records')
        })
    
    return jsonify({"error": "Invalid filter type"}), 400

@server.route('/api/process-flow-after-path')
def get_process_flow_after_path():
    path_str = request.args.get('path')
    mode = request.args.get('mode', 'detailed')
    target_df = aggregated_collapsed_df if mode == 'aggregated' else collapsed_df

    if not path_str:
        return jsonify({"error": "Path required"}), 400
        
    path = path_str.split(',')
    
    if target_df is None:
        return jsonify({"error": "Data not loaded"}), 500
        
    # Filter claims that have the first node of the path (optimization)
    first_node = path[0]
    possible_claims = target_df[target_df['Process'] == first_node]['Claim_Number'].unique()
    subset_df = target_df[target_df['Claim_Number'].isin(possible_claims)]
    
    # Group sequences
    sequences = subset_df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].agg(list)
    
    valid_claims = []
    next_steps = []
    
    for claim_id, seq in sequences.items():
        if len(seq) > len(path):
            if seq[:len(path)] == path:
                next_steps.append(seq[len(path)])
                valid_claims.append(claim_id)
        elif len(seq) == len(path):
            if seq == path:
                valid_claims.append(claim_id)

    total_flow = len(valid_claims)
    if total_flow == 0:
         return jsonify({
            "source_path": path,
            "total_flow": 0,
            "terminations": {"count": 0, "percentage": 0},
            "next_steps": []
        })

    terminations = total_flow - len(next_steps)
    
    next_step_counts = pd.Series(next_steps).value_counts().reset_index()
    if not next_step_counts.empty:
        next_step_counts.columns = ['process', 'count']
        next_step_counts['percentage'] = (next_step_counts['count'] / total_flow * 100).round(1)
        
        # Add percentage of total claims
        total_claims_in_data = len(target_df['Claim_Number'].unique())
        next_step_counts['percentage_of_total'] = (next_step_counts['count'] / total_claims_in_data * 100).round(1)
        
        # Calculate avg duration for next steps
        valid_subset = subset_df[subset_df['Claim_Number'].isin(valid_claims)].copy()
        valid_subset['seq'] = valid_subset.groupby('Claim_Number').cumcount()
        target_rows = valid_subset[valid_subset['seq'] == len(path)]
        
        avg_durations = target_rows.groupby('Process')['Active_Minutes'].mean().round(1).reset_index()
        avg_durations.columns = ['process', 'avg_duration']
        
        # Median duration
        median_durations = target_rows.groupby('Process')['Active_Minutes'].median().round(1).reset_index()
        median_durations.columns = ['process', 'median_duration']
        
        # Max duration
        max_durations = target_rows.groupby('Process')['Active_Minutes'].max().round(1).reset_index()
        max_durations.columns = ['process', 'max_duration']
        
        # Std duration
        std_durations = target_rows.groupby('Process')['Active_Minutes'].std().round(1).reset_index()
        std_durations.columns = ['process', 'std_duration']
        
        # Cumulative time stats
        # Sum active minutes for each claim up to the target row (inclusive)
        # We can filter valid_subset for seq <= len(path)
        path_subset = valid_subset[valid_subset['seq'] <= len(path)]
        cumulative_times = path_subset.groupby('Claim_Number')['Active_Minutes'].sum().reset_index()
        cumulative_times.columns = ['Claim_Number', 'cumulative_time']
        
        # Join back to target_rows to group by process
        target_with_cum = pd.merge(target_rows, cumulative_times, on='Claim_Number')
        
        cum_mean = target_with_cum.groupby('Process')['cumulative_time'].mean().round(1).reset_index()
        cum_mean.columns = ['process', 'mean_cumulative_time']
        
        cum_median = target_with_cum.groupby('Process')['cumulative_time'].median().round(1).reset_index()
        cum_median.columns = ['process', 'median_cumulative_time']
        
        # Remaining steps
        # Get total steps for these claims
        claim_total_steps = target_df[target_df['Claim_Number'].isin(valid_claims)].groupby('Claim_Number').size().reset_index(name='total_steps')
        
        target_with_total = pd.merge(target_rows, claim_total_steps, on='Claim_Number')
        # Current step index is len(path). So steps done is len(path) + 1.
        target_with_total['remaining_steps'] = target_with_total['total_steps'] - (len(path) + 1)
        
        avg_remaining = target_with_total.groupby('Process')['remaining_steps'].mean().round(1).reset_index()
        avg_remaining.columns = ['process', 'avg_remaining_steps']
        
        result_df = pd.merge(next_step_counts, avg_durations, on='process')
        result_df = pd.merge(result_df, median_durations, on='process')
        result_df = pd.merge(result_df, max_durations, on='process')
        result_df = pd.merge(result_df, std_durations, on='process')
        result_df = pd.merge(result_df, cum_mean, on='process')
        result_df = pd.merge(result_df, cum_median, on='process')
        result_df = pd.merge(result_df, avg_remaining, on='process', how='left')
        result_df['avg_remaining_steps'] = result_df['avg_remaining_steps'].fillna(0)
        result_df['std_duration'] = result_df['std_duration'].fillna(0)
        
        next_steps_data = result_df.to_dict(orient='records')
    else:
        next_steps_data = []

    return jsonify({
        "source_path": path,
        "total_flow": total_flow,
        "terminations": {
            "count": terminations,
            "percentage": round(terminations / total_flow * 100, 1)
        },
        "next_steps": next_steps_data
    })

@server.route('/api/activity-flow/starting-nodes')
def get_activity_starting_nodes():
    if activity_collapsed_df is None:
        return jsonify({"error": "Data not loaded"}), 500
        
    # Get first node for each claim
    starting_nodes = activity_collapsed_df.sort_values('First_TimeStamp').groupby('Claim_Number').first().reset_index()
    
    # Count
    node_counts = starting_nodes['Node_Name'].value_counts().reset_index()
    node_counts.columns = ['node_name', 'count']
    
    total_claims = len(starting_nodes)
    node_counts['percentage'] = (node_counts['count'] / total_claims * 100).round(1)
    node_counts['percentage_of_total'] = (node_counts['count'] / total_claims * 100).round(1)
    
    # Avg duration
    avg_durations = starting_nodes.groupby('Node_Name')['Active_Minutes'].mean().round(1).reset_index()
    avg_durations.columns = ['node_name', 'avg_duration_minutes']
    
    # Median duration
    median_durations = starting_nodes.groupby('Node_Name')['Active_Minutes'].median().round(1).reset_index()
    median_durations.columns = ['node_name', 'median_duration']
    
    # Max duration
    max_durations = starting_nodes.groupby('Node_Name')['Active_Minutes'].max().round(1).reset_index()
    max_durations.columns = ['node_name', 'max_duration']
    
    # Merge
    result = pd.merge(node_counts, avg_durations, on='node_name')
    result = pd.merge(result, median_durations, on='node_name')
    result = pd.merge(result, max_durations, on='node_name')
    
    # Add process name for grouping
    result['process'] = result['node_name'].apply(lambda x: x.split(' | ')[0])
    
    return jsonify({
        "total_claims": total_claims,
        "starting_nodes": result.to_dict(orient='records')
    })

@server.route('/api/activity-flow/next-steps')
def get_activity_next_steps():
    path_str = request.args.get('path')
    if not path_str:
        return jsonify({"error": "Path required"}), 400
        
    path = path_str.split(';;')
    
    if activity_collapsed_df is None:
        return jsonify({"error": "Data not loaded"}), 500
        
    # Similar logic to process flow but with activity_collapsed_df
    first_node = path[0]
    possible_claims = activity_collapsed_df[activity_collapsed_df['Node_Name'] == first_node]['Claim_Number'].unique()
    subset_df = activity_collapsed_df[activity_collapsed_df['Claim_Number'].isin(possible_claims)]
    
    sequences = subset_df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Node_Name'].agg(list)
    
    valid_claims = []
    next_steps = []
    
    for claim_id, seq in sequences.items():
        if len(seq) > len(path):
            if seq[:len(path)] == path:
                next_steps.append(seq[len(path)])
                valid_claims.append(claim_id)
        elif len(seq) == len(path):
            if seq == path:
                valid_claims.append(claim_id)
                
    total_flow = len(valid_claims)
    if total_flow == 0:
         return jsonify({
            "source_path": path,
            "total_flow": 0,
            "terminations": {
                "count": 0,
                "percentage": 0
            },
            "next_steps": []
        })

    terminations = total_flow - len(next_steps)
    
    next_step_counts = pd.Series(next_steps).value_counts().reset_index()
    if not next_step_counts.empty:
        next_step_counts.columns = ['node_name', 'count']
        next_step_counts['percentage'] = (next_step_counts['count'] / total_flow * 100).round(1)
        
        # Add percentage of total claims
        total_claims_in_data = len(activity_collapsed_df['Claim_Number'].unique())
        next_step_counts['percentage_of_total'] = (next_step_counts['count'] / total_claims_in_data * 100).round(1)
        
        # Avg duration
        valid_subset = subset_df[subset_df['Claim_Number'].isin(valid_claims)].copy()
        valid_subset['seq'] = valid_subset.groupby('Claim_Number').cumcount()
        target_rows = valid_subset[valid_subset['seq'] == len(path)]
        
        avg_durations = target_rows.groupby('Node_Name')['Active_Minutes'].mean().round(1).reset_index()
        avg_durations.columns = ['node_name', 'avg_duration_minutes']
        
        # Median duration
        median_durations = target_rows.groupby('Node_Name')['Active_Minutes'].median().round(1).reset_index()
        median_durations.columns = ['node_name', 'median_duration']
        
        # Max duration
        max_durations = target_rows.groupby('Node_Name')['Active_Minutes'].max().round(1).reset_index()
        max_durations.columns = ['node_name', 'max_duration']
        
        # Cumulative time stats
        path_subset = valid_subset[valid_subset['seq'] <= len(path)]
        cumulative_times = path_subset.groupby('Claim_Number')['Active_Minutes'].sum().reset_index()
        cumulative_times.columns = ['Claim_Number', 'cumulative_time']
        
        target_with_cum = pd.merge(target_rows, cumulative_times, on='Claim_Number')
        
        cum_mean = target_with_cum.groupby('Node_Name')['cumulative_time'].mean().round(1).reset_index()
        cum_mean.columns = ['node_name', 'mean_cumulative_time']
        
        cum_median = target_with_cum.groupby('Node_Name')['cumulative_time'].median().round(1).reset_index()
        cum_median.columns = ['node_name', 'median_cumulative_time']
        
        # Remaining steps
        claim_total_steps = activity_collapsed_df[activity_collapsed_df['Claim_Number'].isin(valid_claims)].groupby('Claim_Number').size().reset_index(name='total_steps')
        
        target_with_total = pd.merge(target_rows, claim_total_steps, on='Claim_Number')
        target_with_total['remaining_steps'] = target_with_total['total_steps'] - (len(path) + 1)
        
        avg_remaining = target_with_total.groupby('Node_Name')['remaining_steps'].mean().round(1).reset_index()
        avg_remaining.columns = ['node_name', 'avg_remaining_steps']
        
        result_df = pd.merge(next_step_counts, avg_durations, on='node_name')
        result_df = pd.merge(result_df, median_durations, on='node_name')
        result_df = pd.merge(result_df, max_durations, on='node_name')
        result_df = pd.merge(result_df, cum_mean, on='node_name')
        result_df = pd.merge(result_df, cum_median, on='node_name')
        result_df = pd.merge(result_df, avg_remaining, on='node_name', how='left')
        result_df['avg_remaining_steps'] = result_df['avg_remaining_steps'].fillna(0)
        
        next_steps_data = result_df.to_dict(orient='records')
    else:
        next_steps_data = []

    return jsonify({
        "source_path": path,
        "total_flow": total_flow,
        "terminations": {
            "count": terminations,
            "percentage": round(terminations / total_flow * 100, 1)
        },
        "next_steps": next_steps_data
    })

@server.route('/api/claims-at-step')
def get_claims_at_step():
    path_str = request.args.get('path')
    flow_type = request.args.get('type', 'process') # 'process' or 'activity'
    mode = request.args.get('mode', 'detailed')  # 'detailed' or 'aggregated'
    
    if not path_str:
        return jsonify({"error": "Path required"}), 400
        
    if flow_type == 'process':
        separator = ','
        # Use aggregated dataframe if in aggregated mode
        data_df = aggregated_collapsed_df if mode == 'aggregated' else collapsed_df
        col_name = 'Process'
    else:
        separator = ';;'
        data_df = activity_collapsed_df
        col_name = 'Node_Name'
        
    path = path_str.split(separator)
    
    if data_df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    # Check if this is a termination path (ends with 'END')
    is_termination = len(path) > 1 and path[-1] == 'END'
    
    if is_termination:
        # Remove 'END' from path to get the actual process path
        actual_path = path[:-1]
        
        # Filter claims that have the first node
        first_node = actual_path[0]
        possible_claims = data_df[data_df[col_name] == first_node]['Claim_Number'].unique()
        subset_df = data_df[data_df['Claim_Number'].isin(possible_claims)]
        
        # Group sequences
        sequences = subset_df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')[col_name].agg(list)
        
        valid_claims = []
        
        for claim_id, seq in sequences.items():
            # Check if claim followed the exact path and ENDED there (no more steps)
            if len(seq) == len(actual_path) and seq == actual_path:
                valid_claims.append(claim_id)
    else:
        # Original logic for non-termination paths
        first_node = path[0]
        possible_claims = data_df[data_df[col_name] == first_node]['Claim_Number'].unique()
        subset_df = data_df[data_df['Claim_Number'].isin(possible_claims)]
        
        sequences = subset_df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')[col_name].agg(list)
        
        valid_claims = []
        
        for claim_id, seq in sequences.items():
            if len(seq) >= len(path):
                if seq[:len(path)] == path:
                    valid_claims.append(claim_id)
                
    if not valid_claims:
        return jsonify({"claims": []})
        
    # Calculate remaining duration for these claims
    # Get all records for valid claims
    claim_records = data_df[data_df['Claim_Number'].isin(valid_claims)].copy()
    claim_records['seq'] = claim_records.groupby('Claim_Number').cumcount()
    
    if is_termination:
        # For terminated claims, there are no remaining steps
        remaining_durations = pd.DataFrame({
            'Claim_Number': valid_claims,
            'remaining_duration': [0.0] * len(valid_claims)
        })
    else:
        # Filter for steps after the path (index >= len(path))
        remaining_steps = claim_records[claim_records['seq'] >= len(path)]
        
        # Sum remaining duration per claim
        remaining_durations = remaining_steps.groupby('Claim_Number')['Active_Minutes'].sum().reset_index()
        remaining_durations.columns = ['Claim_Number', 'remaining_duration']
    
    # Get total duration for context
    total_durations = claim_records.groupby('Claim_Number')['Active_Minutes'].sum().reset_index()
    total_durations.columns = ['Claim_Number', 'total_duration']
    
    # Merge
    result = pd.DataFrame({'Claim_Number': valid_claims})
    result = pd.merge(result, remaining_durations, on='Claim_Number', how='left')
    result = pd.merge(result, total_durations, on='Claim_Number', how='left')
    
    # Fill NaN with 0 (means no remaining steps, i.e., finished)
    result['remaining_duration'] = result['remaining_duration'].fillna(0).round(1)
    result['total_duration'] = result['total_duration'].round(1)
    
    return jsonify({
        "claims": result.to_dict(orient='records')
    })

@server.route('/api/data-files')
def get_data_files():
    if not os.path.exists(DATA_DIR):
        return jsonify({"files": []})
    
    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.csv')]
    
    # Create friendly labels for each file
    file_options = []
    for idx, filename in enumerate(files, 1):
        # Try to load metadata for each file
        try:
            temp_path = os.path.join(DATA_DIR, filename)
            temp_df = pd.read_csv(temp_path, dtype={'Claim_Number': str})
            temp_df['First_TimeStamp'] = pd.to_datetime(temp_df['First_TimeStamp'])
            
            total_claims = len(temp_df['Claim_Number'].unique())
            min_date = temp_df['First_TimeStamp'].min().strftime('%b %d, %Y')
            max_date = temp_df['First_TimeStamp'].max().strftime('%b %d, %Y')
            
            label = f"Study {idx} • {total_claims} Claims • {min_date} to {max_date}"
            file_options.append({"label": label, "value": filename})
        except:
            # Fallback to filename if metadata can't be loaded
            file_options.append({"label": f"Study {idx} ({filename})", "value": filename})
    
    return jsonify({
        "files": file_options,
        "current_file": current_data_file,
        "summary": data_summary
    })

@server.route('/api/load-data-file', methods=['POST'])
def load_data_file():
    data = request.get_json()
    filename = data.get('filename')
    
    if not filename:
        return jsonify({"error": "Filename required"}), 400
    
    success = load_data(filename)
    
    if success:
        return jsonify({
            "success": True,
            "current_file": current_data_file,
            "summary": data_summary
        })
    else:
        return jsonify({"error": "Failed to load data file"}), 500

@server.route('/api/claim-numbers')
def get_claim_numbers():
    if df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    claim_numbers = sorted(df['Claim_Number'].unique().tolist())
    return jsonify({"claim_numbers": claim_numbers})

@server.route('/api/claim-path/<claim_number>')
def get_claim_path(claim_number):
    mode = request.args.get('mode', 'detailed')
    
    if df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    # Convert to string to match dtype
    claim_number_str = str(claim_number)
    claim_data = df[df['Claim_Number'] == claim_number_str].sort_values('First_TimeStamp')
    
    if claim_data.empty:
        return jsonify({"error": "Claim not found"}), 404
    
    path = []
    for _, row in claim_data.iterrows():
        # Handle NaN activity values
        activity_val = row['Activity'] if 'Activity' in row else None
        if pd.isna(activity_val):
            activity_val = "Unknown"

        # Determine process name based on mode
        process_name = row['Process']
        if mode == 'aggregated' and 'Aggregated_Process' in row:
             process_name = row['Aggregated_Process']

        path.append({
            "process": process_name,
            "activity": activity_val,
            "timestamp": row['First_TimeStamp'].isoformat(),
            "active_minutes": float(row['Active_Minutes'])
        })
    
    return jsonify({
        "claim_number": claim_number,
        "path": path,
        "total_steps": len(path)
    })

# --- Layout & Callbacks ---

app.layout = html.Div([
    dcc.Store(id='data-change-trigger', data=0),
    dcc.Location(id='url', refresh=False),
    dcc.Location(id='url-refresh', refresh=True),
    html.Div([
        html.Div([
            html.H1("WEA Claim Process Flow Dashboard", style={'textAlign': 'center', 'color': '#1A1446', 'margin': 0}),
        ], style={'flex': 1}),
        html.Div([
            html.Label("Data Source:", style={
                'marginRight': '10px', 
                'fontWeight': '600', 
                'color': '#1A1446',
                'fontSize': '14px'
            }),
            dcc.Dropdown(
                id='data-file-selector',
                style={
                    'width': '450px', 
                    'display': 'inline-block',
                    'fontSize': '13px'
                },
                clearable=False
            ),
        ], style={
            'display': 'flex', 
            'alignItems': 'center',
            'backgroundColor': '#f8f9fa',
            'padding': '12px 16px',
            'borderRadius': '8px',
            'border': '1px solid #e0e0e0'
        })
    ], className='header', style={'display': 'flex', 'justifyContent': 'space-between', 'alignItems': 'center', 'padding': '15px 0'}),
    
    dcc.Tabs(id="tabs", value='process-flow', children=[
        dcc.Tab(label='Process Flow', value='process-flow', 
                style={'padding': '10px', 'fontWeight': 'bold'},
                selected_style={'padding': '10px', 'fontWeight': 'bold', 'borderTop': '3px solid #FFD000', 'color': '#1A1446'}),
        dcc.Tab(label='Activity Flow', value='activity-flow',
                style={'padding': '10px', 'fontWeight': 'bold'},
                selected_style={'padding': '10px', 'fontWeight': 'bold', 'borderTop': '3px solid #FFD000', 'color': '#1A1446'}),
        dcc.Tab(label='Claim View', value='claim-view',
                style={'padding': '10px', 'fontWeight': 'bold'},
                selected_style={'padding': '10px', 'fontWeight': 'bold', 'borderTop': '3px solid #FFD000', 'color': '#1A1446'}),
        dcc.Tab(label='Upload Data', value='upload-data',
                style={'padding': '10px', 'fontWeight': 'bold'},
                selected_style={'padding': '10px', 'fontWeight': 'bold', 'borderTop': '3px solid #FFD000', 'color': '#1A1446'}),
    ], style={'marginBottom': '20px'}),
    
    html.Div(id='tabs-content')
])

@app.callback(Output('tabs', 'value'), Input('url', 'search'))
def set_tab(search):
    if search and 'claim=' in search:
        return 'claim-view'
    return dash.no_update

@app.callback(
    [Output('data-file-selector', 'options'),
     Output('data-file-selector', 'value')],
    [Input('url', 'pathname')],
    prevent_initial_call=False
)
def initialize_data_selector(_):
    """Initialize the data file selector with available files"""
    if not os.path.exists(DATA_DIR):
        return [], None
    
    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.csv')]
    
    # Create friendly labels for each file
    options = []
    for idx, filename in enumerate(files, 1):
        try:
            temp_path = os.path.join(DATA_DIR, filename)
            temp_df = pd.read_csv(temp_path, dtype={'Claim_Number': str})
            temp_df['First_TimeStamp'] = pd.to_datetime(temp_df['First_TimeStamp'])
            
            total_claims = len(temp_df['Claim_Number'].unique())
            min_date = temp_df['First_TimeStamp'].min().strftime('%b %d, %Y')
            max_date = temp_df['First_TimeStamp'].max().strftime('%b %d, %Y')
            
            label = f"Study {idx} • {total_claims} Claims • {min_date} to {max_date}"
            options.append({'label': label, 'value': filename})
        except:
            options.append({'label': f"Study {idx} ({filename})", 'value': filename})
    
    if current_data_file:
        return options, current_data_file
    
    return options, files[0] if files else None

@app.callback(
    Output('data-change-trigger', 'data'),
    [Input('data-file-selector', 'value')],
    [State('data-change-trigger', 'data')],
    prevent_initial_call=True
)
def load_selected_data(filename, current_trigger):
    """Load the selected data file"""
    if not filename:
        return current_trigger
    
    success = load_data(filename)
    
    if success:
        # Increment trigger to force refresh
        return (current_trigger or 0) + 1
    
    return current_trigger

@app.callback(Output('tabs-content', 'children'), Input('tabs', 'value'))
def render_content(tab):
    if tab == 'process-flow':
        return html.Div([
            html.Div(id='stats', className='stats-bar', style={'display': 'none'}),
            html.Div([
                html.Div(className='spinner'),
                html.P("Loading process data...")
            ], id='loading', className='loading'),
            html.Div([
                # SVG created by D3
            ], id='tree-container', style={'display': 'none'}),
            html.Div([
                html.Div([html.Div(className='legend-circle process'), html.Span("Process Node")], className='legend-item'),
                html.Div([html.Div(className='legend-circle termination'), html.Span("Termination (End of Process)")], className='legend-item')
            ], id='legend', className='legend', style={'display': 'none'}),
            html.Div(id='tooltip', className='tooltip', style={'display': 'none'})
        ], className='container')
    elif tab == 'activity-flow':
        return html.Div([
            html.Div(id='stats', className='stats-bar', style={'display': 'none'}),
            html.Div([
                html.Div(className='spinner'),
                html.P("Loading activity data...")
            ], id='loading', className='loading'),
            html.Div([
                # SVG created by D3
            ], id='tree-container', style={'display': 'none'}),
            html.Div([
                html.Div([html.Div(className='legend-circle process'), html.Span("Activity Node")], className='legend-item'),
                html.Div([html.Div(className='legend-circle expandable'), html.Span("Expanded / Has Children")], className='legend-item'),
                html.Div([html.Div(className='legend-circle termination'), html.Span("Termination")], className='legend-item')
            ], id='legend', className='legend', style={'display': 'none'}),
            html.Div(id='tooltip', className='tooltip', style={'display': 'none'})
        ], className='container')
    elif tab == 'claim-view':
        return html.Div([
            html.Div([
                html.Div([
                    dcc.Input(id='claimInput', type='number', placeholder='Enter Claim Number (e.g., 40043585)', list='claimList', style={'padding': '10px', 'width': '300px', 'marginRight': '10px'}),
                    html.Datalist(id='claimList'),
                    html.Button('Search', id='searchBtn', n_clicks=0, style={'padding': '10px 20px', 'backgroundColor': '#1A1446', 'color': '#FFD000', 'border': 'none', 'borderRadius': '5px', 'cursor': 'pointer'}),
                ], className='search-box', style={'display': 'flex', 'justifyContent': 'center', 'marginBottom': '20px'}),
                html.Div(id='errorMessage', className='error-message', style={'display': 'none', 'color': 'red', 'textAlign': 'center'}),
                html.Div(id='resultsArea', style={'display': 'none'}, children=[
                    html.Div([
                        html.Div([html.Div(id='totalSteps', className='summary-value'), html.Div('Total Steps', className='summary-label')], className='summary-item'),
                        html.Div([html.Div(id='totalDuration', className='summary-value'), html.Div('Total Active Time', className='summary-label')], className='summary-item'),
                        html.Div([html.Div(id='investigationDuration', className='summary-value'), html.Div('Investigation Time', className='summary-label')], className='summary-item', style={'display': 'none'}, id='investigationStat'),
                        html.Div([html.Div(id='startDate', className='summary-value'), html.Div('Start Date', className='summary-label')], className='summary-item'),
                        html.Div([html.Div(id='endDate', className='summary-value'), html.Div('End Date', className='summary-label')], className='summary-item'),
                    ], className='stats-summary', style={'display': 'flex', 'justifyContent': 'space-around', 'marginBottom': '20px', 'padding': '15px', 'background': '#f8f9fa', 'borderRadius': '10px', 'borderLeft': '5px solid #FFD000'}),
                    
                    html.Div([
                        # Left Column: Timeline
                        html.Div([
                            html.H3("Timeline", style={'color': '#1A1446', 'marginBottom': '15px', 'borderBottom': '2px solid #eee', 'paddingBottom': '10px'}),
                            html.Div(id='timeline', className='timeline')
                        ], style={'flex': '1', 'marginRight': '20px', 'paddingTop': '20px'}),
                        
                        # Right Column: Visualizations
                        html.Div([
                            html.H3("Analysis", style={'color': '#1A1446', 'marginBottom': '15px', 'borderBottom': '2px solid #eee', 'paddingBottom': '10px'}),
                            html.Div(id='process-analysis', style={'marginBottom': '30px'}),
                            html.Div(id='activity-analysis')
                        ], style={'flex': '1', 'paddingLeft': '20px', 'borderLeft': '1px solid #e0e0e0', 'backgroundColor': '#fcfcfc', 'borderRadius': '8px', 'padding': '20px'})
                    ], style={'display': 'flex', 'flexDirection': 'row', 'gap': '20px'})
                ])
            ], className='container')
        ])
    elif tab == 'upload-data':
        return html.Div([
            dcc.Upload(
                id='upload-data',
                children=html.Div([
                    'Drag and Drop or ',
                    html.A('Select Files')
                ]),
                style={
                    'width': '100%',
                    'height': '60px',
                    'lineHeight': '60px',
                    'borderWidth': '1px',
                    'borderStyle': 'dashed',
                    'borderRadius': '5px',
                    'textAlign': 'center',
                    'margin': '10px'
                },
                # Allow multiple files to be uploaded
                multiple=False
            ),
            html.Div(id='output-data-upload'),
        ], className='container')

clientside_callback(
    """
    function(tab) {
        setTimeout(function() {
            if (tab === 'process-flow') {
                if (window.ProcessFlow) {
                    console.log("Initializing Process Flow");
                    window.ProcessFlow.init();
                }
            } else if (tab === 'activity-flow') {
                if (window.ActivityFlow) {
                    console.log("Initializing Activity Flow");
                    window.ActivityFlow.init();
                }
            } else if (tab === 'claim-view') {
                if (window.ClaimView) {
                    console.log("Initializing Claim View");
                    window.ClaimView.init();
                }
            }
        }, 500);
        return window.dash_clientside.no_update;
    }
    """,
    Output('tabs-content', 'id'),
    Input('tabs', 'value')
)

# Clientside callback to refresh current tab when data changes
clientside_callback(
    """
    function(trigger, tab) {
        if (trigger > 0) {
            setTimeout(function() {
                console.log("Data changed, refreshing", tab);
                if (tab === 'process-flow' && window.ProcessFlow) {
                    window.ProcessFlow.init(true);
                } else if (tab === 'activity-flow' && window.ActivityFlow) {
                    window.ActivityFlow.init(true);
                } else if (tab === 'claim-view' && window.ClaimView) {
                    window.ClaimView.init();
                }
            }, 500);
        }
        return window.dash_clientside.no_update;
    }
    """,
    Output('data-change-trigger', 'id'),
    Input('data-change-trigger', 'data'),
    State('tabs', 'value')
)

def parse_contents(contents, filename):
    content_type, content_string = contents.split(',')
    decoded = base64.b64decode(content_string)
    try:
        if 'csv' in filename:
            # Save the file to DATA_DIR
            if not os.path.exists(DATA_DIR):
                os.makedirs(DATA_DIR)
            
            file_path = os.path.join(DATA_DIR, filename)
            with open(file_path, 'wb') as f:
                f.write(decoded)
            
            # Reload data to pick up the new file (or the latest one)
            load_data()
            
            record_count = len(df) if df is not None else 0
            return html.Div([
                html.H5(f"Successfully uploaded and saved {filename}"),
                html.P(f"Loaded {record_count} records."),
                html.Button('Restart Dashboard', id='restart-btn', n_clicks=0, style={'backgroundColor': '#1A1446', 'color': '#FFD000', 'padding': '10px', 'borderRadius': '5px', 'border': 'none', 'cursor': 'pointer', 'marginTop': '10px'}),
                html.Hr(),
            ])
        else:
            return html.Div([
                html.H5(f"File {filename} is not a CSV file.")
            ])
    except Exception as e:
        print(e)
        return html.Div([
            html.H5(f"There was an error processing this file: {e}")
        ])

@app.callback(Output('output-data-upload', 'children'),
              Input('upload-data', 'contents'),
              State('upload-data', 'filename'))
def update_output(contents, filename):
    if contents is not None:
        return parse_contents(contents, filename)

@app.callback(Output('url-refresh', 'href'),
              Input('restart-btn', 'n_clicks'),
              prevent_initial_call=True)
def restart_dashboard(n_clicks):
    if n_clicks > 0:
        return '/'
    return dash.no_update

def get_server():
    return server

if __name__ == '__main__':
    app.run(debug=True, port=8050)

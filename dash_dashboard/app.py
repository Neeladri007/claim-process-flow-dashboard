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

# Initialize Dash app
app = dash.Dash(__name__, server=server, title="WEA Claim Process Flow", suppress_callback_exceptions=True)

# Load Data
APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_DIR, "data")

# Global variables
df = None
collapsed_df = None
activity_collapsed_df = None

def get_latest_csv():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    
    files = [os.path.join(DATA_DIR, f) for f in os.listdir(DATA_DIR) if f.endswith('.csv')]
    if not files:
        return None
    
    latest_file = max(files, key=os.path.getmtime)
    return latest_file

def process_dataframe(dataframe):
    global df, collapsed_df, activity_collapsed_df
    df = dataframe
    df['First_TimeStamp'] = pd.to_datetime(df['First_TimeStamp'])
    
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
    
    print(f"Loaded {len(df)} records")

def load_data():
    csv_path = get_latest_csv()
    
    if not csv_path:
        print(f"No CSV file found in: {DATA_DIR}")
        return

    print(f"Loading data from {csv_path}...")
    temp_df = pd.read_csv(csv_path)
    process_dataframe(temp_df)

load_data()

# --- API Routes ---

@server.route('/api/starting-processes')
def get_starting_processes():
    if collapsed_df is None:
        return jsonify({"error": "Data not loaded"}), 500
        
    # Get the first process for each claim
    starting_processes = collapsed_df.sort_values('First_TimeStamp').groupby('Claim_Number').first().reset_index()
    
    # Count occurrences
    process_counts = starting_processes['Process'].value_counts().reset_index()
    process_counts.columns = ['process', 'count']
    
    total_claims = len(starting_processes)
    process_counts['percentage'] = (process_counts['count'] / total_claims * 100).round(1)
    
    # Calculate average duration (Active_Minutes)
    avg_durations = starting_processes.groupby('Process')['Active_Minutes'].mean().round(1).reset_index()
    avg_durations.columns = ['process', 'avg_duration']
    
    # Merge
    result = pd.merge(process_counts, avg_durations, on='process')
    
    return jsonify({
        "total_claims": total_claims,
        "starting_processes": result.to_dict(orient='records')
    })

@server.route('/api/process-flow/<path:process_name>')
def get_process_flow(process_name):
    filter_type = request.args.get('filter_type', 'all')
    
    if collapsed_df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    if filter_type == 'starting':
        # Find claims that START with this process
        starting_claims = collapsed_df.sort_values('First_TimeStamp').groupby('Claim_Number').first()
        claim_ids = starting_claims[starting_claims['Process'] == process_name].index.tolist()
        
        # Filter main df for these claims
        filtered_df = collapsed_df[collapsed_df['Claim_Number'].isin(claim_ids)].copy()
        
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
        
        next_step_counts['percentage'] = (next_step_counts['count'] / total_flow * 100).round(1)
        
        # Avg duration of the NEXT step
        avg_durations = next_steps_df.groupby('Process')['Active_Minutes'].mean().round(1).reset_index()
        avg_durations.columns = ['process', 'avg_duration']
        
        result_df = pd.merge(next_step_counts, avg_durations, on='process')
        
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
    if not path_str:
        return jsonify({"error": "Path required"}), 400
        
    path = path_str.split(',')
    
    if collapsed_df is None:
        return jsonify({"error": "Data not loaded"}), 500
        
    # Filter claims that have the first node of the path (optimization)
    first_node = path[0]
    possible_claims = collapsed_df[collapsed_df['Process'] == first_node]['Claim_Number'].unique()
    subset_df = collapsed_df[collapsed_df['Claim_Number'].isin(possible_claims)]
    
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
        
        # Calculate avg duration for next steps
        valid_subset = subset_df[subset_df['Claim_Number'].isin(valid_claims)].copy()
        valid_subset['seq'] = valid_subset.groupby('Claim_Number').cumcount()
        target_rows = valid_subset[valid_subset['seq'] == len(path)]
        
        avg_durations = target_rows.groupby('Process')['Active_Minutes'].mean().round(1).reset_index()
        avg_durations.columns = ['process', 'avg_duration']
        
        result_df = pd.merge(next_step_counts, avg_durations, on='process')
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
    
    # Avg duration
    avg_durations = starting_nodes.groupby('Node_Name')['Active_Minutes'].mean().round(1).reset_index()
    avg_durations.columns = ['node_name', 'avg_duration_minutes']
    
    # Merge
    result = pd.merge(node_counts, avg_durations, on='node_name')
    
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
        
        # Avg duration
        valid_subset = subset_df[subset_df['Claim_Number'].isin(valid_claims)].copy()
        valid_subset['seq'] = valid_subset.groupby('Claim_Number').cumcount()
        target_rows = valid_subset[valid_subset['seq'] == len(path)]
        
        avg_durations = target_rows.groupby('Node_Name')['Active_Minutes'].mean().round(1).reset_index()
        avg_durations.columns = ['node_name', 'avg_duration_minutes']
        
        result_df = pd.merge(next_step_counts, avg_durations, on='node_name')
        result_df['process'] = result_df['node_name'].apply(lambda x: x.split(' | ')[0])
        
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

@server.route('/api/claim-numbers')
def get_claim_numbers():
    if df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    claim_numbers = sorted(df['Claim_Number'].unique().tolist())
    return jsonify({"claim_numbers": claim_numbers})

@server.route('/api/claim-path/<int:claim_number>')
def get_claim_path(claim_number):
    if df is None:
        return jsonify({"error": "Data not loaded"}), 500
    
    claim_data = df[df['Claim_Number'] == claim_number].sort_values('First_TimeStamp')
    
    if claim_data.empty:
        return jsonify({"error": "Claim not found"}), 404
    
    path = []
    for _, row in claim_data.iterrows():
        path.append({
            "process": row['Process'],
            "activity": row['Activity'] if 'Activity' in row else None,
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
    dcc.Location(id='url-refresh', refresh=True),
    html.Div([
        html.H1("WEA Claim Process Flow Dashboard", style={'textAlign': 'center', 'color': '#1A1446'}),
    ], className='header'),
    
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
                        html.Div([html.Div(id='startDate', className='summary-value'), html.Div('Start Date', className='summary-label')], className='summary-item'),
                        html.Div([html.Div(id='endDate', className='summary-value'), html.Div('End Date', className='summary-label')], className='summary-item'),
                    ], className='stats-summary', style={'display': 'flex', 'justifyContent': 'space-around', 'marginBottom': '20px', 'padding': '15px', 'background': '#f8f9fa', 'borderRadius': '10px', 'borderLeft': '5px solid #FFD000'}),
                    html.Div(id='timeline', className='timeline')
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

if __name__ == '__main__':
    app.run(debug=True, port=8050)

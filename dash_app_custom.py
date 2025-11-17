import dash
from dash import html
import pandas as pd
from collections import Counter

# Load the data
df = pd.read_csv('simulated_claim_activities.csv')

# Initialize the Dash app
app = dash.Dash(
    __name__, 
    suppress_callback_exceptions=True,
    external_scripts=[
        'https://d3js.org/d3.v7.min.js'
    ]
)

def get_starting_processes():
    """Get the starting process for each claim"""
    first_processes = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].first()
    process_counts = first_processes.value_counts()
    
    total = len(first_processes)
    result = []
    for process, count in process_counts.items():
        result.append({
            'process': process,
            'count': int(count),
            'percentage': round((count / total) * 100, 2)
        })
    
    return sorted(result, key=lambda x: x['count'], reverse=True)

def get_process_flow(process_name, filter_type='starting'):
    """Get immediate next steps after a process"""
    claim_sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].apply(list).to_dict()
    
    transitions = []
    terminations = 0
    matching_claims = 0
    
    if filter_type == 'starting':
        for claim_num, processes in claim_sequences.items():
            if len(processes) > 0 and processes[0] == process_name:
                matching_claims += 1
                if len(processes) > 1:
                    transitions.append(processes[1])
                else:
                    terminations += 1
    
    if matching_claims == 0:
        return {'total_claims': 0, 'total_flows': 0, 'next_steps': [], 'terminations': {'count': 0, 'percentage': 0}}
    
    transition_counts = Counter(transitions)
    total_flows = len(transitions) + terminations
    
    next_steps = []
    for next_process, count in transition_counts.items():
        next_steps.append({
            'process': next_process,
            'count': int(count),
            'percentage': round((count / total_flows) * 100, 2) if total_flows > 0 else 0
        })
    
    next_steps.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        'total_claims': matching_claims,
        'total_flows': total_flows,
        'next_steps': next_steps,
        'terminations': {
            'count': terminations,
            'percentage': round((terminations / total_flows) * 100, 2) if total_flows > 0 else 0
        }
    }

def get_process_flow_after_path(process_path):
    """Get flow data after following a specific path from the start"""
    claim_sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].apply(list).to_dict()
    
    transitions = []
    terminations = 0
    matching_claims = 0
    
    path_len = len(process_path)
    
    for claim_num, processes in claim_sequences.items():
        if len(processes) >= path_len:
            if processes[:path_len] == process_path:
                matching_claims += 1
                if len(processes) > path_len:
                    transitions.append(processes[path_len])
                else:
                    terminations += 1
    
    if matching_claims == 0:
        return {'total_claims': 0, 'total_flows': 0, 'next_steps': [], 'terminations': {'count': 0, 'percentage': 0}}
    
    transition_counts = Counter(transitions)
    total_flows = len(transitions) + terminations
    
    next_steps = []
    for next_process, count in transition_counts.items():
        next_steps.append({
            'process': next_process,
            'count': int(count),
            'percentage': round((count / total_flows) * 100, 2) if total_flows > 0 else 0
        })
    
    next_steps.sort(key=lambda x: x['count'], reverse=True)
    
    return {
        'total_claims': matching_claims,
        'total_flows': total_flows,
        'next_steps': next_steps,
        'terminations': {
            'count': terminations,
            'percentage': round((terminations / total_flows) * 100, 2) if total_flows > 0 else 0
        }
    }

# Add Flask routes for API endpoints
from flask import jsonify, request

@app.server.route('/api/starting-processes')
def api_starting_processes():
    return jsonify(get_starting_processes())

@app.server.route('/api/process-flow/<process_name>')
def api_process_flow(process_name):
    filter_type = request.args.get('filter_type', 'starting')
    return jsonify(get_process_flow(process_name, filter_type))

@app.server.route('/api/process-flow-after-path')
def api_process_flow_after_path():
    path = request.args.get('path', '')
    process_path = [p.strip() for p in path.split(',')]
    return jsonify(get_process_flow_after_path(process_path))

# App layout
app.layout = html.Div([
    # Header
    html.Div([
        html.H1("Claim Process Flow Dashboard", className='header-title'),
        html.P("Click on any node to explore process transitions • Drag to move • Scroll to zoom", 
               className='header-subtitle')
    ], className='header-section'),
    
    # Controls bar
    html.Div([
        html.Div([
            html.Span("📍 ", style={'fontSize': '18px'}),
            html.Span("Click on a node to explore", id='breadcrumb-text')
        ], className='breadcrumb'),
        
        html.Button([
            html.Span("↺ ", style={'marginRight': '5px'}),
            'Reset View'
        ], id='reset-btn', className='reset-btn', n_clicks=0)
    ], className='controls-bar'),
    
    # Legend
    html.Div([
        html.Div([
            html.Span("●", className='legend-symbol', style={'color': '#4ECDC4'}),
            html.Span("Process Node")
        ], className='legend-item'),
        
        html.Div([
            html.Span("✕", className='legend-symbol', style={'color': '#E74C3C'}),
            html.Span("Termination")
        ], className='legend-item'),
        
        html.Div([
            html.Span("━", className='legend-symbol', style={'color': '#95A5A6'}),
            html.Span("Process Flow")
        ], className='legend-item'),
        
        html.Div([
            html.Span("━", className='legend-symbol', style={'color': '#E74C3C'}),
            html.Span("Termination Path")
        ], className='legend-item'),
    ], className='legend-section'),
    
    # Network canvas
    html.Div(id='network-canvas'),
    
], className='dashboard-container', id='app-container')

# Add callback for reset button
from dash import Input, Output, clientside_callback

clientside_callback(
    """
    function(n_clicks) {
        if (n_clicks > 0 && typeof resetVisualization !== 'undefined') {
            resetVisualization();
        }
        return '';
    }
    """,
    Output('breadcrumb-text', 'children'),
    Input('reset-btn', 'n_clicks'),
    prevent_initial_call=True
)

if __name__ == '__main__':
    app.run(debug=True, port=8050)

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
    # Take the first row (process + active minutes) per claim
    first_rows = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number').first()

    # Aggregate by starting process: count and average active minutes (only for the starting step)
    agg = first_rows.groupby('Process').agg(
        count=('Process', 'size'),
        avg_duration=('Active_Minutes', 'mean')
    ).reset_index()

    total = len(first_rows)
    result = []
    for _, row in agg.iterrows():
        result.append({
            'process': row['Process'],
            'count': int(row['count']),
            'percentage': round((row['count'] / total) * 100, 2),
            'avg_duration': round(float(row['avg_duration']), 2)
        })

    return sorted(result, key=lambda x: x['count'], reverse=True)

def get_process_flow(process_name, filter_type='starting'):
    """Get immediate next steps after a process"""
    # Build sequences that include active minutes for each step: list of (process, active_minutes)
    claim_sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number').apply(lambda g: list(zip(g['Process'], g['Active_Minutes']))).to_dict()

    transitions = []  # will store tuples (next_process, next_duration)
    terminations = 0
    matching_claims = 0
    parent_durations = []  # durations of the current process_name occurrences among matching claims

    if filter_type == 'starting':
        for claim_num, processes in claim_sequences.items():
            if len(processes) > 0 and processes[0][0] == process_name:
                matching_claims += 1
                # record parent (current) duration
                parent_durations.append(float(processes[0][1]))
                if len(processes) > 1:
                    transitions.append((processes[1][0], float(processes[1][1])))
                else:
                    terminations += 1
    else:
        for claim_num, processes in claim_sequences.items():
            # find first occurrence of process_name
            for i, (proc, dur) in enumerate(processes):
                if proc == process_name:
                    matching_claims += 1
                    parent_durations.append(float(dur))
                    if i < len(processes) - 1:
                        transitions.append((processes[i+1][0], float(processes[i+1][1])))
                    else:
                        terminations += 1
                    break

    if matching_claims == 0:
        return {'process': process_name, 'filter_type': filter_type, 'total_claims': 0, 'total_flows': 0, 'next_steps': [], 'terminations': {'count': 0, 'percentage': 0}, 'process_avg_duration': 0}

    # Aggregate transitions by next_process and compute avg durations for each next step
    transition_agg = {}
    for next_proc, next_dur in transitions:
        if next_proc not in transition_agg:
            transition_agg[next_proc] = {'count': 0, 'sum_duration': 0.0}
        transition_agg[next_proc]['count'] += 1
        transition_agg[next_proc]['sum_duration'] += float(next_dur)

    total_flows = len(transitions) + terminations

    next_steps = []
    for next_process, vals in transition_agg.items():
        cnt = vals['count']
        avg_dur = vals['sum_duration'] / cnt if cnt > 0 else 0
        next_steps.append({
            'process': next_process,
            'count': int(cnt),
            'percentage': round((cnt / total_flows) * 100, 2) if total_flows > 0 else 0,
            'avg_duration': round(avg_dur, 2)
        })

    # Sort by count descending
    next_steps.sort(key=lambda x: x['count'], reverse=True)

    # Average duration of the current process among matching claims
    process_avg_duration = round(sum(parent_durations) / len(parent_durations), 2) if parent_durations else 0

    return {
        'process': process_name,
        'filter_type': filter_type,
        'total_claims': matching_claims,
        'total_flows': total_flows,
        'next_steps': next_steps,
        'terminations': {
            'count': terminations,
            'percentage': round((terminations / total_flows) * 100, 2) if total_flows > 0 else 0
        },
        'process_avg_duration': process_avg_duration
    }

def get_process_flow_after_path(process_path):
    """Get flow data after following a specific path from the start
    process_path: list of process names (e.g., ["Total Loss", "Claim Admin"]).
    Returns counts, next steps and average durations for next steps and for the last node in the path.
    """
    # Build sequences that include active minutes for each step: list of (process, active_minutes)
    claim_sequences = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number').apply(lambda g: list(zip(g['Process'], g['Active_Minutes']))).to_dict()

    transitions = []  # will store tuples (next_process, next_duration)
    terminations = 0
    matching_claims = 0
    parent_durations = []  # durations of the last node in the path among matching claims

    path_len = len(process_path)

    for claim_num, processes in claim_sequences.items():
        if len(processes) >= path_len:
            # Compare only process names for the beginning of the sequence
            if [p for p, _ in processes[:path_len]] == process_path:
                matching_claims += 1
                parent_durations.append(float(processes[path_len-1][1]))
                if len(processes) > path_len:
                    transitions.append((processes[path_len][0], float(processes[path_len][1])))
                else:
                    terminations += 1

    if matching_claims == 0:
        return {
            'path': process_path,
            'total_claims': 0,
            'total_flows': 0,
            'next_steps': [],
            'terminations': {'count': 0, 'percentage': 0},
            'path_avg_duration': 0
        }

    # Aggregate transitions
    transition_agg = {}
    for next_proc, next_dur in transitions:
        if next_proc not in transition_agg:
            transition_agg[next_proc] = {'count': 0, 'sum_duration': 0.0}
        transition_agg[next_proc]['count'] += 1
        transition_agg[next_proc]['sum_duration'] += float(next_dur)

    total_flows = len(transitions) + terminations

    next_steps = []
    for next_process, vals in transition_agg.items():
        cnt = vals['count']
        avg_dur = vals['sum_duration'] / cnt if cnt > 0 else 0
        next_steps.append({
            'process': next_process,
            'count': int(cnt),
            'percentage': round((cnt / total_flows) * 100, 2) if total_flows > 0 else 0,
            'avg_duration': round(avg_dur, 2)
        })

    # Sort by count descending
    next_steps.sort(key=lambda x: x['count'], reverse=True)

    path_avg_duration = round(sum(parent_durations) / len(parent_durations), 2) if parent_durations else 0

    return {
        'path': process_path,
        'total_claims': matching_claims,
        'total_flows': total_flows,
        'next_steps': next_steps,
        'terminations': {
            'count': terminations,
            'percentage': round((terminations / total_flows) * 100, 2) if total_flows > 0 else 0
        },
        'path_avg_duration': path_avg_duration
    }
    
# App layout (reconstructed)
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

# Add callback for reset button (clientside)
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

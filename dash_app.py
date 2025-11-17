import dash
from dash import dcc, html, Input, Output, State, callback_context
import plotly.graph_objects as go
import pandas as pd
from collections import Counter
import numpy as np
import json
import math

# Load the data
df = pd.read_csv('simulated_claim_activities.csv')

# Initialize the Dash app
app = dash.Dash(__name__, suppress_callback_exceptions=True)

# Color palette for processes
PROCESS_COLORS = {
    'Total Loss': '#FF6B6B',
    'Liability': '#4ECDC4',
    'Coverage': '#45B7D1',
    'Settlement': '#FFA07A',
    'Recovery': '#98D8C8',
    'Desktop Management': '#F7DC6F',
    'Claim Admin': '#BB8FCE',
    'Schedule Services': '#85C1E2',
    'Communication': '#F8B739',
    'Claim related teams chats': '#52B788'
}

def get_color(process_name):
    return PROCESS_COLORS.get(process_name, '#95a5a6')

def get_starting_processes():
    """Get the starting process for each claim"""
    first_processes = df.sort_values(['Claim_Number', 'First_TimeStamp']).groupby('Claim_Number')['Process'].first()
    process_counts = first_processes.value_counts()
    
    total = len(first_processes)
    result = []
    for process, count in process_counts.items():
        result.append({
            'process': process,
            'count': count,
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
            'count': count,
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
            'count': count,
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

def calculate_radial_layout(nodes):
    """Calculate circular/radial layout for better distribution"""
    # Group by depth
    depth_groups = {}
    for node in nodes:
        depth = node['depth']
        if depth not in depth_groups:
            depth_groups[depth] = []
        depth_groups[depth].append(node)
    
    positions = {}
    
    for depth, depth_nodes in depth_groups.items():
        n = len(depth_nodes)
        # Radius increases with depth
        radius = 200 + depth * 250
        
        # Distribute nodes in a circle
        for i, node in enumerate(depth_nodes):
            angle = (2 * math.pi * i) / n
            node_id = node['id']
            
            positions[node_id] = {
                'x': radius * math.cos(angle),
                'y': radius * math.sin(angle),
                'radius': node['radius']
            }
    
    return positions

def create_graph(expanded_nodes):
    """Create enhanced Plotly graph visualization"""
    if not expanded_nodes:
        # Show starting processes
        starting = get_starting_processes()
        nodes = []
        for i, proc in enumerate(starting):
            nodes.append({
                'id': f"start_{proc['process']}",
                'name': proc['process'],
                'count': proc['count'],
                'percentage': proc['percentage'],
                'depth': 0,
                'path': [proc['process']],
                'isStarting': True,
                'isTermination': False,
                'radius': 30 + (proc['count'] / 114) * 25
            })
        expanded_nodes = nodes
    
    # Calculate layout
    positions = calculate_radial_layout(expanded_nodes)
    
    # Create figure
    fig = go.Figure()
    
    # Add edges with better styling
    for node in expanded_nodes:
        if 'parent_id' in node and node['parent_id']:
            parent = next((n for n in expanded_nodes if n['id'] == node['parent_id']), None)
            if parent and node['id'] in positions and parent['id'] in positions:
                # Different color for termination edges
                edge_color = '#ff6b6b' if node.get('isTermination') else '#95a5a6'
                edge_width = 3 if node.get('isTermination') else 2
                
                fig.add_trace(go.Scatter(
                    x=[positions[parent['id']]['x'], positions[node['id']]['x']],
                    y=[positions[parent['id']]['y'], positions[node['id']]['y']],
                    mode='lines',
                    line=dict(width=edge_width, color=edge_color),
                    hoverinfo='none',
                    showlegend=False,
                    opacity=0.6
                ))
    
    # Add nodes
    for node in expanded_nodes:
        if node['id'] not in positions:
            continue
            
        pos = positions[node['id']]
        
        # Different styling for termination nodes
        if node.get('isTermination'):
            color = '#e74c3c'
            symbol = 'x'
            border_color = '#c0392b'
        else:
            color = get_color(node['name'])
            symbol = 'circle'
            border_color = 'white'
        
        # Create hover text
        path_str = ' → '.join(node['path']) if not node.get('isTermination') else ' → '.join(node['path'][:-1]) + ' → END'
        hover_text = f"<b>{node['name']}</b><br>"
        hover_text += f"Claims: {node['count']}<br>"
        hover_text += f"Percentage: {node['percentage']:.1f}%<br>"
        hover_text += f"Path: {path_str}<br>"
        hover_text += "<i>Click to expand</i>" if not node.get('isTermination') else "<i>Termination point</i>"
        
        # Add node
        fig.add_trace(go.Scatter(
            x=[pos['x']],
            y=[pos['y']],
            mode='markers+text',
            marker=dict(
                size=pos['radius'] * 2,
                color=color,
                symbol=symbol,
                line=dict(width=3, color=border_color),
                opacity=0.9
            ),
            text=f"<b>{node['count']}</b>",
            textposition="middle center",
            textfont=dict(size=11, color='white', family='Arial Black'),
            hovertemplate=hover_text + '<extra></extra>',
            customdata=[[node['id'], node.get('isTermination', False)]],
            name='',
            showlegend=False
        ))
        
        # Add label below node
        fig.add_annotation(
            x=pos['x'],
            y=pos['y'] - pos['radius'] - 15,
            text=node['name'],
            showarrow=False,
            font=dict(size=10, color='#2c3e50', family='Arial'),
            bgcolor='rgba(255, 255, 255, 0.8)',
            borderpad=4,
            bordercolor='#bdc3c7',
            borderwidth=1
        )
    
    fig.update_layout(
        title={
            'text': "Claim Process Flow - Interactive Network",
            'font': {'size': 24, 'color': '#2c3e50', 'family': 'Arial'},
            'x': 0.5,
            'xanchor': 'center'
        },
        width=1400,
        height=900,
        xaxis=dict(
            showgrid=False, 
            zeroline=False, 
            showticklabels=False,
            range=[-800, 800]
        ),
        yaxis=dict(
            showgrid=False, 
            zeroline=False, 
            showticklabels=False,
            range=[-800, 800]
        ),
        hovermode='closest',
        plot_bgcolor='#f8f9fa',
        paper_bgcolor='#ecf0f1',
        margin=dict(l=40, r=40, t=100, b=40)
    )
    
    return fig

# App layout with better design
app.layout = html.Div([
    # Header
    html.Div([
        html.H1("Claim Process Flow Dashboard", 
                style={'margin': 0, 'color': 'white'}),
        html.P("Click on any node to explore process transitions", 
               style={'margin': '5px 0 0 0', 'color': '#ecf0f1', 'fontSize': 14})
    ], style={
        'background': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'padding': '20px 40px',
        'boxShadow': '0 2px 10px rgba(0,0,0,0.1)'
    }),
    
    # Stats bar
    html.Div([
        html.Div([
            html.Div([
                html.Span("📊", style={'fontSize': 24, 'marginRight': 10}),
                html.Span("Total Claims: 100", id='total-claims',
                         style={'fontSize': 18, 'fontWeight': 'bold', 'color': '#2c3e50'})
            ], style={'flex': 1}),
            
            html.Div([
                html.Span("🔄", style={'fontSize': 24, 'marginRight': 10}),
                html.Span("Current Path: Start", id='current-path',
                         style={'fontSize': 16, 'color': '#7f8c8d'})
            ], style={'flex': 2}),
            
            html.Div([
                html.Button('↺ Reset View', id='reset-button', n_clicks=0,
                           style={
                               'padding': '10px 24px',
                               'backgroundColor': '#3498db',
                               'color': 'white',
                               'border': 'none',
                               'borderRadius': '25px',
                               'cursor': 'pointer',
                               'fontSize': 14,
                               'fontWeight': 'bold',
                               'boxShadow': '0 2px 8px rgba(52, 152, 219, 0.3)',
                               'transition': 'all 0.3s'
                           })
            ], style={'flex': 1, 'textAlign': 'right'})
        ], style={
            'display': 'flex',
            'alignItems': 'center',
            'gap': 20
        })
    ], style={
        'padding': '20px 40px',
        'backgroundColor': 'white',
        'borderBottom': '1px solid #e0e0e0',
        'boxShadow': '0 2px 4px rgba(0,0,0,0.05)'
    }),
    
    # Legend
    html.Div([
        html.Div([
            html.Div([
                html.Span("●", style={'color': '#4ECDC4', 'fontSize': 20, 'marginRight': 8}),
                html.Span("Process Node", style={'fontSize': 13, 'color': '#2c3e50'})
            ], style={'display': 'flex', 'alignItems': 'center', 'marginRight': 30}),
            
            html.Div([
                html.Span("✕", style={'color': '#e74c3c', 'fontSize': 20, 'marginRight': 8}),
                html.Span("Termination", style={'fontSize': 13, 'color': '#2c3e50'})
            ], style={'display': 'flex', 'alignItems': 'center', 'marginRight': 30}),
            
            html.Div([
                html.Span("━", style={'color': '#95a5a6', 'fontSize': 20, 'marginRight': 8}),
                html.Span("Process Flow", style={'fontSize': 13, 'color': '#2c3e50'})
            ], style={'display': 'flex', 'alignItems': 'center', 'marginRight': 30}),
            
            html.Div([
                html.Span("━", style={'color': '#ff6b6b', 'fontSize': 20, 'marginRight': 8}),
                html.Span("Termination Path", style={'fontSize': 13, 'color': '#2c3e50'})
            ], style={'display': 'flex', 'alignItems': 'center'})
        ], style={'display': 'flex', 'justifyContent': 'center'})
    ], style={
        'padding': '15px',
        'backgroundColor': '#f8f9fa',
        'borderBottom': '1px solid #e0e0e0'
    }),
    
    # Graph container
    html.Div([
        dcc.Graph(
            id='flow-graph',
            figure=create_graph([]),
            config={'displayModeBar': True, 'displaylogo': False},
            style={'borderRadius': 10, 'overflow': 'hidden'}
        )
    ], style={'padding': '20px 40px', 'backgroundColor': '#ecf0f1'}),
    
    # Store for tracking expanded nodes
    dcc.Store(id='expanded-nodes-store', data=[])
    
], style={'fontFamily': 'Arial, sans-serif', 'backgroundColor': '#ecf0f1', 'minHeight': '100vh'})

@app.callback(
    [Output('flow-graph', 'figure'),
     Output('expanded-nodes-store', 'data'),
     Output('current-path', 'children')],
    [Input('flow-graph', 'clickData'),
     Input('reset-button', 'n_clicks')],
    [State('expanded-nodes-store', 'data')]
)
def update_graph(clickData, reset_clicks, current_nodes):
    """Handle node clicks to expand the tree"""
    ctx = callback_context
    
    if not ctx.triggered:
        # Initial load
        starting = get_starting_processes()
        nodes = []
        for proc in starting:
            nodes.append({
                'id': f"start_{proc['process']}",
                'name': proc['process'],
                'count': proc['count'],
                'percentage': proc['percentage'],
                'depth': 0,
                'path': [proc['process']],
                'isStarting': True,
                'isTermination': False,
                'radius': 30 + (proc['count'] / 114) * 25
            })
        return create_graph(nodes), nodes, "Click on a node to expand"
    
    trigger_id = ctx.triggered[0]['prop_id'].split('.')[0]
    
    if trigger_id == 'reset-button':
        # Reset to starting view
        starting = get_starting_processes()
        nodes = []
        for proc in starting:
            nodes.append({
                'id': f"start_{proc['process']}",
                'name': proc['process'],
                'count': proc['count'],
                'percentage': proc['percentage'],
                'depth': 0,
                'path': [proc['process']],
                'isStarting': True,
                'isTermination': False,
                'radius': 30 + (proc['count'] / 114) * 25
            })
        return create_graph(nodes), nodes, "Click on a node to expand"
    
    if clickData is None:
        return dash.no_update, dash.no_update, dash.no_update
    
    # Get clicked node
    point = clickData['points'][0]
    if 'customdata' not in point:
        return dash.no_update, dash.no_update, dash.no_update
    
    clicked_node_id = point['customdata'][0]
    is_termination = point['customdata'][1] if len(point['customdata']) > 1 else False
    
    # Don't expand termination nodes
    if is_termination:
        return dash.no_update, dash.no_update, dash.no_update
    
    # Find the clicked node in current nodes
    clicked_node = next((n for n in current_nodes if n['id'] == clicked_node_id), None)
    if not clicked_node:
        return dash.no_update, dash.no_update, dash.no_update
    
    # Check if already expanded
    if any(n.get('parent_id') == clicked_node_id for n in current_nodes):
        # Already expanded, don't expand again
        return dash.no_update, dash.no_update, dash.no_update
    
    # Get children for this node
    if clicked_node.get('isStarting'):
        flow_data = get_process_flow(clicked_node['name'], 'starting')
    else:
        flow_data = get_process_flow_after_path(clicked_node['path'])
    
    # Add children nodes
    new_nodes = current_nodes.copy()
    child_depth = clicked_node['depth'] + 1
    
    # Calculate radius for this level
    if flow_data['next_steps']:
        max_count = max(step['count'] for step in flow_data['next_steps'])
        
        for step in flow_data['next_steps']:
            child_path = clicked_node['path'] + [step['process']]
            child_id = f"{clicked_node['id']}_{step['process']}"
            
            # Radius proportional to count at this level
            radius = 25 + (step['count'] / max_count) * 30
            
            new_nodes.append({
                'id': child_id,
                'name': step['process'],
                'count': step['count'],
                'percentage': step['percentage'],
                'depth': child_depth,
                'path': child_path,
                'parent_id': clicked_node_id,
                'isTermination': False,
                'radius': radius
            })
    
    # Add termination node if any
    if flow_data['terminations']['count'] > 0:
        term_id = f"{clicked_node['id']}_termination"
        term_path = clicked_node['path'] + ['END']
        
        # Termination node radius
        max_count_with_term = max(
            [step['count'] for step in flow_data['next_steps']] + [flow_data['terminations']['count']]
        ) if flow_data['next_steps'] else flow_data['terminations']['count']
        
        radius = 25 + (flow_data['terminations']['count'] / max_count_with_term) * 30
        
        new_nodes.append({
            'id': term_id,
            'name': 'END',
            'count': flow_data['terminations']['count'],
            'percentage': flow_data['terminations']['percentage'],
            'depth': child_depth,
            'path': term_path,
            'parent_id': clicked_node_id,
            'isTermination': True,
            'radius': radius
        })
    
    # Create breadcrumb
    breadcrumb = " → ".join(clicked_node['path'])
    
    return create_graph(new_nodes), new_nodes, f"{breadcrumb}"

if __name__ == '__main__':
    app.run(debug=True, port=8050)

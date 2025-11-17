# Claim Process Flow Analyzer

An interactive dashboard to visualize claim process flows with hierarchical navigation.

## Features

- 📊 **Interactive Flow Visualization**: Click through process stages to see how claims flow
- 📈 **Real-time Statistics**: See claim counts and percentages at each stage
- 🔄 **Bidirectional Flows**: Supports claims moving back and forth between processes
- 🏁 **Termination Tracking**: Shows where claims end their journey
- 🗺️ **Breadcrumb Navigation**: Easy navigation with back button and breadcrumb trail

## Setup

### 1. Install Dependencies

```powershell
pip install -r requirements.txt
```

### 2. Start the FastAPI Server

```powershell
python main.py
```

The server will start on `http://localhost:8000`

### 3. Open the Dashboard

Open your browser and go to: `http://localhost:8000`

## How It Works

### Backend (FastAPI)
- Reads `simulated_claim_activities.csv`
- Processes data to build process flow transitions
- Provides REST API endpoints:
  - `/api/starting-processes` - Get all starting processes
  - `/api/process-flow/{process_name}` - Get flow data for a specific process
  - `/api/all-processes` - Get all unique processes
  - `/api/claim-path/{claim_number}` - Get complete path for a claim

### Frontend (HTML/CSS/JS)
- Beautiful, responsive UI with gradient design
- Interactive cards showing process statistics
- Click on any process to drill down
- Back button and breadcrumb navigation
- Real-time data updates from API

## Usage

1. **Start Page**: Shows all starting processes with claim counts and percentages
2. **Click a Process**: See where those claims went next
3. **Continue Drilling Down**: Keep clicking to follow the claim journey
4. **Back Button**: Navigate back through your exploration path
5. **Termination Cards**: Red cards show where claims ended

## API Examples

### Get starting processes:
```bash
curl http://localhost:8000/api/starting-processes
```

### Get flow for a specific process (starting filter):
```bash
curl "http://localhost:8000/api/process-flow/Claim%20Admin?filter_type=starting"
```

### Get complete path for a claim:
```bash
curl http://localhost:8000/api/claim-path/48062551
```

## File Structure

```
.
├── main.py                           # FastAPI backend
├── index.html                        # Frontend dashboard
├── simulated_claim_activities.csv    # Data source
├── requirements.txt                  # Python dependencies
└── README.md                         # This file
```

## Technologies Used

- **Backend**: FastAPI, Pandas
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Styling**: Modern gradient design with animations

## Notes

- The dashboard processes CSV data in real-time
- Supports complex bidirectional process flows
- No external charting libraries needed - pure CSS/JS visualization

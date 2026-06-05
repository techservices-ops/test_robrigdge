const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Barcode generation endpoint (for production, you'll need to host Python backend separately)
app.post('/api/generate_barcode', async (req, res) => {
  try {
    // For production, you'll need to replace this with your hosted Python backend URL
    const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'https://your-python-backend.herokuapp.com';
    
    const response = await fetch(`${PYTHON_BACKEND_URL}/generate_barcode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
    });

    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to communicate with Python backend',
      message: 'Please ensure the Python backend is deployed and accessible'
    });
  }
});

// Get barcode image endpoint
app.get('/api/get_barcode/:filename', async (req, res) => {
  try {
    const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'https://your-python-backend.herokuapp.com';
    
    const response = await fetch(`${PYTHON_BACKEND_URL}/get_barcode/${req.params.filename}`);
    
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      res.set('Content-Type', response.headers.get('Content-Type'));
      res.send(Buffer.from(buffer));
    } else {
      res.status(response.status).json({ 
        success: false, 
        error: 'Failed to get barcode image' 
      });
    }
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to communicate with Python backend' 
    });
  }
});

// List barcodes endpoint
app.get('/api/list_barcodes', async (req, res) => {
  try {
    const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'https://your-python-backend.herokuapp.com';
    
    const response = await fetch(`${PYTHON_BACKEND_URL}/list_barcodes`);
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Error proxying to Python backend:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to communicate with Python backend' 
    });
  }
});

module.exports = app;

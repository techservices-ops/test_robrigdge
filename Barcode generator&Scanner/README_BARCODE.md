# Barcode Generator API

A Python Flask-based API for generating 2D (QR codes) and 1D barcodes with SQLite database integration.

## Features

- ✅ Generate QR Codes (2D)
- ✅ Generate 1D Barcodes (Code128, EAN13, etc.)
- ✅ SQLite database storage
- ✅ Web and mobile source tracking
- ✅ Metadata support
- ✅ RESTful API endpoints
- ✅ CORS enabled for cross-origin requests

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Run the barcode generator server:
```bash
python barcode_generator.py
```

The server will start on `http://localhost:5000`

## API Endpoints

### 1. Generate Barcode
**POST** `/generate_barcode`

Generate a new barcode (QR code or 1D barcode).

**Request Body:**
```json
{
    "data": "Your barcode data here",
    "type": "qr",  // "qr", "code128", "ean13", etc.
    "source": "web",  // "web" or "mobile"
    "metadata": {
        "product_id": "12345",
        "category": "electronics",
        "user_id": "user123"
    }
}
```

**Response:**
```json
{
    "success": true,
    "message": "QR barcode generated successfully",
    "filename": "barcodes/qr_20231201_143022.png",
    "data": "Your barcode data here",
    "type": "qr",
    "source": "web"
}
```

### 2. Get Barcode Image
**GET** `/get_barcode/<filename>`

Retrieve a generated barcode image.

**Example:** `GET /get_barcode/qr_20231201_143022.png`

### 3. List All Barcodes
**GET** `/list_barcodes`

Get a list of all generated barcodes from the database.

**Response:**
```json
{
    "barcodes": [
        {
            "id": 1,
            "data": "Your barcode data",
            "type": "qr",
            "source": "web",
            "created_at": "2023-12-01 14:30:22",
            "file_path": "barcodes/qr_20231201_143022.png",
            "metadata": {
                "product_id": "12345",
                "category": "electronics"
            }
        }
    ]
}
```

### 4. Health Check
**GET** `/health`

Check if the API is running.

**Response:**
```json
{
    "status": "healthy",
    "message": "Barcode generator is running"
}
```

## Usage Examples

### Generate QR Code from Web
```python
import requests

data = {
    "data": "https://www.example.com/product/12345",
    "type": "qr",
    "source": "web",
    "metadata": {
        "product_id": "12345",
        "category": "electronics"
    }
}

response = requests.post("http://localhost:5000/generate_barcode", json=data)
result = response.json()
print(f"QR Code generated: {result['filename']}")
```

### Generate 1D Barcode from Mobile
```python
import requests

data = {
    "data": "123456789012",
    "type": "code128",
    "source": "mobile",
    "metadata": {
        "sku": "SKU123456",
        "warehouse": "WH001"
    }
}

response = requests.post("http://localhost:5000/generate_barcode", json=data)
result = response.json()
print(f"Barcode generated: {result['filename']}")
```

### JavaScript/React Example
```javascript
const generateBarcode = async (barcodeData, type, source) => {
    try {
        const response = await fetch('http://localhost:5000/generate_barcode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                data: barcodeData,
                type: type,
                source: source,
                metadata: {
                    user_id: 'user123',
                    timestamp: new Date().toISOString()
                }
            })
        });
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Error generating barcode:', error);
    }
};

// Usage
generateBarcode('https://example.com', 'qr', 'web')
    .then(result => {
        console.log('Barcode generated:', result.filename);
        // Display the barcode image
        const imgUrl = `http://localhost:5000/get_barcode/${result.filename.split('/').pop()}`;
        document.getElementById('barcode-image').src = imgUrl;
    });
```

## Database Schema

The SQLite database (`barcodes.db`) contains a single table:

```sql
CREATE TABLE barcodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode_data TEXT NOT NULL,
    barcode_type TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    file_path TEXT,
    metadata TEXT
);
```

## Supported Barcode Types

### 2D Barcodes
- **QR Code** (`qr`) - Most common 2D barcode

### 1D Barcodes
- **Code128** (`code128`) - General purpose barcode
- **EAN13** (`ean13`) - European Article Number
- **EAN8** (`ean8`) - Short EAN
- **UPC** (`upc`) - Universal Product Code
- **ISBN13** (`isbn13`) - International Standard Book Number
- **ISBN10** (`isbn10`) - Short ISBN

## File Structure

```
├── barcode_generator.py      # Main Flask application
├── test_barcode_generator.py # Test script
├── requirements.txt          # Python dependencies
├── README_BARCODE.md        # This file
├── barcodes/                # Generated barcode images
└── barcodes.db             # SQLite database
```

## Testing

Run the test script to verify everything works:

```bash
python test_barcode_generator.py
```

This will:
1. Test health check
2. Generate a QR code
3. Generate a Code128 barcode
4. List all barcodes in the database

## Error Handling

The API includes comprehensive error handling:
- Invalid barcode data
- Unsupported barcode types
- Database connection issues
- File system errors

All errors return appropriate HTTP status codes and error messages.

## Security Considerations

- The API accepts data from any source (web/mobile)
- Consider adding authentication for production use
- Validate input data before processing
- Implement rate limiting for high-traffic scenarios
- Secure the database file in production environments

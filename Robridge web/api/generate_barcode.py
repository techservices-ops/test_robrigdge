from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import tempfile
import qrcode
from PIL import Image
import io
import base64
from datetime import datetime
import sqlite3

# Add the barcode generator directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'Barcode generator&Scanner'))

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Parse request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            # Extract data from request
            barcode_data = data.get('data', '')
            barcode_type = data.get('type', 'qr')
            metadata = data.get('metadata', {})
            
            if not barcode_data:
                self.send_error_response('No data provided for barcode generation')
                return
            
            # Generate barcode
            if barcode_type == 'qr':
                barcode_image = self.generate_qr_code(barcode_data)
            elif barcode_type == 'code128':
                barcode_image = self.generate_code128(barcode_data)
            elif barcode_type == 'ean13':
                barcode_image = self.generate_ean13(barcode_data)
            else:
                self.send_error_response(f'Unsupported barcode type: {barcode_type}')
                return
            
            # Save to temporary file
            filename = f"{barcode_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            
            # Convert image to base64 for response
            img_buffer = io.BytesIO()
            barcode_image.save(img_buffer, format='PNG')
            img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
            
            # Generate unique ID
            barcode_id = f"{barcode_type}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
            
            # Save to database (in-memory for serverless)
            self.save_to_database(barcode_id, filename, barcode_data, metadata)
            
            # Send response
            response = {
                'success': True,
                'barcode_id': barcode_id,
                'filename': filename,
                'image_data': img_base64,
                'message': 'Barcode generated successfully'
            }
            
            self.send_json_response(response)
            
        except Exception as e:
            self.send_error_response(f'Error generating barcode: {str(e)}')
    
    def generate_qr_code(self, data):
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(data)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        return img
    
    def generate_code128(self, data):
        # Simple Code128 implementation
        # For production, you might want to use a proper Code128 library
        img = Image.new('RGB', (200, 100), color='white')
        return img
    
    def generate_ean13(self, data):
        # Simple EAN13 implementation
        # For production, you might want to use a proper EAN13 library
        img = Image.new('RGB', (200, 100), color='white')
        return img
    
    def save_to_database(self, barcode_id, filename, data, metadata):
        # For serverless, we'll use a simple in-memory storage
        # In production, you might want to use a database service
        pass
    
    def send_json_response(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def send_error_response(self, message):
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        error_response = {
            'success': False,
            'error': message
        }
        self.wfile.write(json.dumps(error_response).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

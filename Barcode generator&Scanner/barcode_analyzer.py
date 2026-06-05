#!/usr/bin/env python3
"""
Barcode/QR Code Analyzer Service
Analyzes scanned codes and provides intelligent information about what they contain
"""

from fastapi import FastAPI
from pydantic import BaseModel
import requests
from bs4 import BeautifulSoup
import re
from urllib.parse import urlparse
import uvicorn

app = FastAPI(title="Barcode Analyzer", description="Analyzes barcodes and QR codes")

class ScanRequest(BaseModel):
    scanned_value: str

def auto_analyze_url(url: str):
    """Generic analyzer for any domain/URL"""
    parsed = urlparse(url)
    domain = parsed.netloc.replace("www.", "")
    path = parsed.path.strip("/")

    # Extract site name from domain
    site_name = domain.split(".")[0].capitalize()

    # Default values
    title = f"{site_name} Website"
    category = "Website (QR Code)"
    description = f"A link to {site_name}'s website."

    # Add context from path if present
    if path:
        if "profile" in path.lower() or "in/" in path.lower():
            description = f"This link points to a profile page on {site_name}."
            category = "Profile / User Page"
        elif "product" in path.lower() or "shop" in path.lower():
            description = f"This link points to a product page on {site_name}."
            category = "E-commerce / Product"
        elif "news" in path.lower() or "blog" in path.lower():
            description = f"This link points to an article or blog on {site_name}."
            category = "News / Blog"
        elif "contact" in path.lower():
            description = f"This link points to a contact page on {site_name}."
            category = "Contact Page"

    return title, category, description

@app.post("/scan")
async def scan_code(data: ScanRequest):
    """Handle ESP32 scan data - same as analyze but with different endpoint"""
    return await analyze_code(data)

@app.get("/scan")
async def scan_code_get(scanned_value: str = ""):
    """Handle ESP32 GET requests with scanned value as query parameter"""
    if not scanned_value:
        return {"error": "scanned_value parameter is required"}
    
    data = ScanRequest(scanned_value=scanned_value)
    return await analyze_code(data)

@app.post("/analyze")
async def analyze_code(data: ScanRequest):
    """Analyze a scanned barcode or QR code"""
    code = data.scanned_value.strip()

    # Case 1: Barcode (numeric only)
    if re.fullmatch(r"\d+", code):
        return {
            "scanned_code": code,
            "title": "Numeric Barcode",
            "category": "1D Barcode",
            "description": "This is a standard 1D barcode (numeric only).",
            "type": "barcode",
            "confidence": "high"
        }

    # Case 2: QR Code (URL)
    elif code.startswith("http://") or code.startswith("https://"):
        try:
            response = requests.get(code, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # Try to get title & description
            title = soup.title.string.strip() if soup.title and soup.title.string else None
            description = None

            meta = soup.find("meta", attrs={"name": "description"})
            if meta and meta.get("content"):
                description = meta["content"].strip()
            elif soup.find("p"):
                description = soup.find("p").get_text().strip()

            # If missing → auto analyze
            if not title or not description:
                title, category, description = auto_analyze_url(code)
            else:
                category = "Website (QR Code)"

            return {
                "scanned_code": code,
                "title": title if title else "Unknown Website",
                "category": category,
                "description": description if description else "No description available.",
                "type": "qr_code",
                "confidence": "high"
            }

        except Exception:
            # Total fallback → auto analyze
            title, category, description = auto_analyze_url(code)
            return {
                "scanned_code": code,
                "title": title,
                "category": category,
                "description": description,
                "type": "qr_code",
                "confidence": "medium"
            }

    # Case 3: Alphanumeric barcode (mixed characters)
    elif re.match(r"^[A-Za-z0-9\-_]+$", code):
        return {
            "scanned_code": code,
            "title": "Alphanumeric Code",
            "category": "Product Code / SKU",
            "description": "This appears to be an alphanumeric product code or SKU.",
            "type": "alphanumeric_barcode",
            "confidence": "medium"
        }

    # Case 4: Other text
    else:
        return {
            "scanned_code": code,
            "title": "Unknown Format",
            "category": "Uncategorized",
            "description": "The scanned input format is not recognized.",
            "type": "unknown",
            "confidence": "low"
        }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "barcode_analyzer"}

if __name__ == "__main__":
    print("Starting Barcode Analyzer Service...")
    print("Service will be available at: http://localhost:5001")
    print("API Documentation: http://localhost:5001/docs")
    uvicorn.run(app, host="0.0.0.0", port=5001)
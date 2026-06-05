from fastapi import FastAPI
from pydantic import BaseModel
from openai import OpenAI
import uvicorn
import re
import os
import logging
import aiohttp
from fastapi.middleware.cors import CORSMiddleware

# ======================
# CONFIGURATION
# ======================
# Configure logging first
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Force load from env.env if exists
if not os.getenv("OPENAI_API_KEY") and os.path.exists("env.env"):
    with open("env.env") as f:
        for line in f:
            if line.startswith("OPENAI_API_KEY="):
                os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Validate API key
if not OPENAI_API_KEY:
    logger.warning("OPENAI_API_KEY environment variable is not set!")
    logger.warning("AI analysis will use fallback responses.")
    client = None
else:
    client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="Robridge AI Scanner", version="2.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Log the API key being used
if OPENAI_API_KEY:
    logger.info(f"Using OpenAI API Key: {OPENAI_API_KEY[:20]}...")
else:
    logger.info("No OpenAI API Key configured - using fallback responses")

# ======================
# Pydantic Models
# ======================
class ScanInput(BaseModel):
    scanned_value: str

class ESP32ScanInput(BaseModel):
    deviceId: str
    barcodeData: str
    deviceName: str = None
    scanType: str = None
    timestamp: int = None

class AIAnalysisResponse(BaseModel):
    success: bool
    title: str
    category: str
    description: str
    description_short: str = None  # For ESP32 display (138 char limit)
    country: str = "Unknown"
    barcode: str
    deviceId: str

# ======================
# COUNTRY CODE MAPPING (EAN Prefixes)
# ======================
COUNTRY_CODES = {
    "890": "India",
    "000": "United States",
    "001": "United States",
    "002": "United States",
    "003": "United States",
    "004": "United States",
    "005": "United States",
    "030": "France",
    "380": "Bulgaria",
    "400": "Germany",
    "450": "Japan",
    "460": "Russia",
    "500": "United Kingdom",
    "539": "Ireland",
    "560": "Portugal",
    "590": "Poland",
    "600": "South Africa",
    "690": "China",
    "700": "Norway",
    "729": "Israel",
    "740": "Guatemala",
    "750": "Mexico",
    "780": "Chile",
    "789": "Brazil",
    "810": "Italy",
    "840": "Spain",
    "869": "Turkey",
    "880": "South Korea",
    "885": "Thailand",
    "890": "India",
    "893": "Vietnam",
    "899": "Indonesia",
}

# ======================
# Helper Functions
# ======================
def get_country_from_barcode(barcode: str) -> str:
    prefix = barcode[:3]
    return COUNTRY_CODES.get(prefix, "Unknown Country")

async def fetch_product_info(barcode: str) -> dict:
    """
    Fetch product information from multiple barcode databases
    """
    product_info = {
        "found": False,
        "product_name": None,
        "brand": None,
        "category": None,
        "description": None,
        "image_url": None
    }
    
    # Try Open Food Facts API (great for food products)
    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://world.openfoodfacts.org/api/v0/product/{barcode}.json"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("status") == 1:
                        product = data.get("product", {})
                        product_info["found"] = True
                        product_info["product_name"] = product.get("product_name") or product.get("product_name_en")
                        product_info["brand"] = product.get("brands")
                        product_info["category"] = product.get("categories")
                        product_info["description"] = product.get("generic_name") or product.get("ingredients_text")
                        product_info["image_url"] = product.get("image_url")
                        return product_info
    except Exception as e:
        logger.error(f"Open Food Facts API error: {e}")
    
    # Try UPCitemdb API (general products)
    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://api.upcitemdb.com/prod/trial/lookup?upc={barcode}"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("code") == "OK" and data.get("items"):
                        item = data["items"][0]
                        product_info["found"] = True
                        product_info["product_name"] = item.get("title")
                        product_info["brand"] = item.get("brand")
                        product_info["category"] = item.get("category")
                        product_info["description"] = item.get("description")
                        product_info["image_url"] = item.get("images", [None])[0] if item.get("images") else None
                        return product_info
    except Exception as e:
        logger.error(f"UPCitemdb API error: {e}")
    
    # Try Barcode Lookup API (alternative)
    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://api.barcodelookup.com/v3/products?barcode={barcode}&formatted=y&key=demo"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("products"):
                        item = data["products"][0]
                        product_info["found"] = True
                        product_info["product_name"] = item.get("product_name") or item.get("title")
                        product_info["brand"] = item.get("brand")
                        product_info["category"] = item.get("category")
                        product_info["description"] = item.get("description")
                        product_info["image_url"] = item.get("images", [None])[0] if item.get("images") else None
                        return product_info
    except Exception as e:
        logger.error(f"Barcode Lookup API error: {e}")
    
    return product_info

def generate_barcode_info(barcode: str):
    """
    Generate local explanation for a 1D barcode.
    """
    country = get_country_from_barcode(barcode)
    return f"""
Scanned Code: {barcode}
Title: 1D Barcode
Category: {country} Barcode
Description: A 1D barcode, also known as a linear barcode, is a machine-readable code that represents product information using parallel lines of varying widths. 
It is commonly printed on product packaging and used globally for inventory tracking, retail scanning, and supply chain management. 
Each 1D barcode encodes numeric or alphanumeric data, which is read by optical scanners or cameras. 
These codes help automate the checkout process, manage product identification, and maintain efficient logistics systems. 
The first few digits in this barcode identify the country and company prefix, linking it to registered manufacturers and distributors.
""".strip()

def generate_qr_info(url: str):
    """
    Generates detailed 5-6 sentence summary about the QR link.
    """
    prompt = f"""
    The scanned QR code contains this link: {url}.
    Identify what it represents — e.g., an organization, person, or brand.
    Return output in the exact format:

    Scanned Code: {url}
    Title: <Name or Brand>
    Category: <Type - Website, Person, Organization, Social Media>
    Description: <Write 5–6 factual and descriptive sentences about the entity, 
    its purpose, reputation, and what a visitor would find or do on that link.>
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You describe QR links accurately and consistently without extra commentary."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3
    )

    return response.choices[0].message.content.strip()

# ======================
# Endpoints
# ======================
@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "Robridge AI Scanner", "version": "2.0.0"}

@app.post("/test-esp32")
async def test_esp32(data: dict):
    logger.info(f"Test ESP32 received: {data}")
    return {"success": True, "received": data}

@app.post("/api/esp32/ping/{device_id}")
async def esp32_ping(device_id: str):
    """ESP32 heartbeat/ping endpoint"""
    logger.info(f"ESP32 ping received from {device_id}")
    return {"status": "ok", "deviceId": device_id, "timestamp": "pong"}

@app.get("/api/esp32/ping/{device_id}")
async def esp32_ping_get(device_id: str):
    """ESP32 heartbeat/ping endpoint (GET)"""
    logger.info(f"ESP32 ping GET received from {device_id}")
    return {"status": "ok", "deviceId": device_id, "timestamp": "pong"}

@app.post("/api/esp32/scan")
async def esp32_scan(data: ESP32ScanInput):
    try:
        logger.info(f"ESP32 scan received from {data.deviceId}: {data.barcodeData}")
        logger.info(f"Additional data - deviceName: {data.deviceName}, scanType: {data.scanType}, timestamp: {data.timestamp}")
        
        # Check if device name contains "AI" for AI analysis
        device_name = data.deviceName or ""
        has_ai = "AI" in device_name.upper()
        
        logger.info(f"Device name: '{device_name}', Contains AI: {has_ai}")
        
        if not has_ai:
            # Device doesn't have "AI" in name - return basic analysis
            logger.info("Device does not have 'AI' in name - returning basic analysis")
            return AIAnalysisResponse(
                success=True,
                title="Basic Scan",
                category="Basic Product",
                description="Basic scan without AI analysis. Device does not support AI processing.",
                description_short="Basic scan - no AI analysis",
                country="Unknown",
                barcode=data.barcodeData,
                deviceId=data.deviceId
            )
        
        # Case 1: Numeric barcode
        if re.fullmatch(r"\d{8,14}", data.barcodeData):
            country = get_country_from_barcode(data.barcodeData)
            logger.info(f"Processing numeric barcode from {country}")
            
            # Fetch product information from database
            product_info = await fetch_product_info(data.barcodeData)
            
            # Enhanced barcode description based on country
            prefix = data.barcodeData[:3]
            barcode_length = len(data.barcodeData)
            
            if barcode_length == 13:
                barcode_type = "EAN-13 (European Article Number)"
            elif barcode_length == 12:
                barcode_type = "UPC-A (Universal Product Code)"
            elif barcode_length == 8:
                barcode_type = "EAN-8"
            else:
                barcode_type = "Standard Product Barcode"
            
            # Build description based on whether product was found
            if product_info["found"]:
                # Product found in database
                product_name = product_info["product_name"] or "Unknown Product"
                brand = product_info["brand"] or "Unknown Brand"
                category = product_info["category"] or "General Product"
                
                title = f"{product_name}"
                
                # Full description for website (plain text, no markdown or emojis)
                description = f"Product Identified: {product_name}\n\n"
                description += f"Brand: {brand}\n"
                description += f"Category: {category}\n"
                description += f"Origin: {country} (Barcode prefix: {prefix})\n"
                description += f"Barcode Type: {barcode_type}\n\n"
                
                if product_info["description"]:
                    description += f"Details: {product_info['description'][:200]}...\n\n"
                
                description += f"This product is registered in international product databases and is used for retail identification and inventory management. "
                description += f"The barcode encodes manufacturer identification, product code, and validation information. "
                
                if country == "India":
                    description += f"This Indian product (prefix 890) is registered with GS1 India."
                elif country == "United States":
                    description += f"This US product follows the UPC standard widely used in North American retail."
                elif country != "Unknown Country":
                    description += f"This product from {country} complies with international GS1 barcode standards."
                
                # Short description for ESP32 display (138 char limit)
                description_short = f"{product_name} by {brand}. Category: {category}. Origin: {country}. Type: {barcode_type}."
                if len(description_short) > 138:
                    description_short = description_short[:135] + "..."
                
                logger.info(f"Product found: {product_name} by {brand}")
                
            else:
                # Product not found in database
                title = f"Product Barcode - {country}"
                
                # Full description for website (plain text, no markdown or emojis)
                description = f"Product Lookup: No product information found in public databases for this barcode.\n\n"
                description += f"Barcode Type: {barcode_type}\n"
                description += f"Country of Origin: {country} (prefix: {prefix})\n\n"
                description += f"This barcode is commonly used for retail product identification and inventory management. "
                description += f"The barcode encodes product information including manufacturer identification, product code, and a check digit for validation. "
                description += f"It is scanned at point-of-sale systems for pricing and inventory tracking. "
                
                if country == "India":
                    description += f"Indian products (prefix 890) are registered with GS1 India and are used across retail, manufacturing, and supply chain operations throughout the country."
                elif country == "United States":
                    description += f"US products are registered with GS1 US and follow the Universal Product Code (UPC) standard widely used in North American retail."
                elif country != "Unknown Country":
                    description += f"Products from {country} are registered with their national GS1 organization and comply with international barcode standards."
                else:
                    description += f"This barcode may be from a private labeling system or a region not yet identified in the standard GS1 prefix database."
                
                # Short description for ESP32 display (138 char limit)
                description_short = f"Product not found. Type: {barcode_type}. Origin: {country} (prefix {prefix}). Retail product barcode."
                if len(description_short) > 138:
                    description_short = description_short[:135] + "..."
                
                logger.info(f"Product not found in databases for barcode: {data.barcodeData}")
            
            return AIAnalysisResponse(
                success=True,
                title=title,
                category=f"{country} Product",
                description=description,
                description_short=description_short,
                country=country,
                barcode=data.barcodeData,
                deviceId=data.deviceId
            )
        
        # Case 2: QR code / URL
        elif data.barcodeData.startswith(("http://", "https://", "www.")):
            try:
                logger.info(f"Processing QR code/URL: {data.barcodeData}")
                
                # Simple URL analysis without OpenAI for now
                url = data.barcodeData
                domain = url.split('/')[2] if '/' in url else url
                
                # Enhanced domain-based categorization with detailed descriptions
                if 'rajalakshmi' in domain.lower():
                    title = "Rajalakshmi Educational Institution"
                    category = "Educational Institution"
                    description = f"This QR code directs to Rajalakshmi Educational Institution's official portal. The institution is a prominent engineering and educational establishment. This specific URL appears to be part of their student registration or identification system, likely used for student verification, attendance tracking, or accessing academic resources. The encrypted registration number in the URL ensures secure access to personalized student information and services."
                elif 'google' in domain.lower():
                    title = "Google Services"
                    category = "Technology Platform"
                    description = f"This QR code connects to Google's ecosystem of services. Google is the world's leading technology company offering search, cloud computing, productivity tools, and digital services. This link may provide access to Google Drive, Gmail, Google Meet, Google Docs, or other collaborative and productivity applications. Users can access documents, join meetings, or utilize various Google workspace features through this link."
                elif 'facebook' in domain.lower():
                    title = "Facebook"
                    category = "Social Media Platform"
                    description = f"This QR code links to Facebook, the world's largest social networking platform with billions of active users. It may direct to a personal profile, business page, group, event, or specific post. Facebook enables users to connect with friends and family, share content, join communities, and engage with businesses. Scanning this code provides quick access to Facebook content without manual searching."
                elif 'youtube' in domain.lower():
                    title = "YouTube"
                    category = "Video Streaming Platform"
                    description = f"This QR code connects to YouTube, the world's premier video sharing and streaming platform owned by Google. It may link to a specific video, channel, playlist, or live stream. YouTube hosts billions of videos covering entertainment, education, tutorials, music, news, and more. This QR code provides instant access to video content without typing or searching, making it ideal for sharing multimedia content."
                elif 'instagram' in domain.lower():
                    title = "Instagram"
                    category = "Social Media Platform"
                    description = f"This QR code links to Instagram, a popular photo and video sharing social media platform owned by Meta. It may direct to a user profile, specific post, story, reel, or IGTV content. Instagram is widely used for visual storytelling, brand marketing, influencer content, and personal expression through images and short videos. Scanning provides immediate access to Instagram content and profiles."
                elif 'twitter' in domain.lower() or 'x.com' in domain.lower():
                    title = "Twitter/X"
                    category = "Social Media Platform"
                    description = f"This QR code links to Twitter (now rebranded as X), a microblogging and social networking platform. It may direct to a user profile, specific tweet, thread, or trending topic. Twitter/X is known for real-time news, public conversations, and short-form content limited to character counts. The platform is widely used for breaking news, public discourse, brand communication, and connecting with thought leaders and communities."
                elif 'linkedin' in domain.lower():
                    title = "LinkedIn"
                    category = "Professional Network"
                    description = f"This QR code connects to LinkedIn, the world's largest professional networking platform. It may link to a professional profile, company page, job posting, or article. LinkedIn is used for career development, professional networking, job searching, business connections, and industry insights. This QR code enables quick professional connections and access to career-related content."
                elif 'whatsapp' in domain.lower():
                    title = "WhatsApp"
                    category = "Messaging Platform"
                    description = f"This QR code links to WhatsApp, a widely-used encrypted messaging application owned by Meta. It may connect to a personal chat, business account, group, or WhatsApp Web session. WhatsApp enables instant messaging, voice and video calls, file sharing, and business communication. Scanning this code can initiate conversations or join groups without manually adding contacts."
                elif 'github' in domain.lower():
                    title = "GitHub"
                    category = "Developer Platform"
                    description = f"This QR code links to GitHub, the world's leading platform for software development and version control. It may direct to a code repository, developer profile, project, or open-source contribution. GitHub is essential for collaborative coding, project management, code review, and software distribution. This link provides access to source code, documentation, and development resources."
                elif 'amazon' in domain.lower():
                    title = "Amazon"
                    category = "E-Commerce Platform"
                    description = f"This QR code connects to Amazon, the world's largest online marketplace and e-commerce platform. It may link to a product listing, store page, deal, or Amazon service. Amazon offers millions of products across categories including electronics, books, clothing, groceries, and digital services. Scanning provides quick access to products, reviews, and purchasing options."
                elif 'me-qr' in domain.lower() or 'qr-code' in domain.lower():
                    title = "QR Code Service"
                    category = "QR Code Generator"
                    description = f"This QR code was created using a QR code generation service. These platforms allow users to create custom QR codes that can link to websites, contact information, WiFi credentials, or other digital content. The destination of this code depends on what the creator configured. QR code services are commonly used for marketing, event management, contactless information sharing, and digital business cards."
                else:
                    title = f"Website: {domain}"
                    category = "Website"
                    description = f"This QR code contains a web link to {domain}. QR codes are two-dimensional barcodes that store information and can be quickly scanned using smartphone cameras. This particular code directs to a website where you can access information, services, or content. The specific purpose depends on the website owner's intent - it could be for marketing, information sharing, authentication, payment, or accessing digital resources. Always verify the source before scanning QR codes from unknown origins."
                
                # Create short description for ESP32 (138 char limit)
                description_short = f"{title}. Category: {category}. QR code link to {domain}."
                if len(description_short) > 138:
                    description_short = description_short[:135] + "..."
                
                logger.info(f"QR analysis completed: {title} - {category}")
                return AIAnalysisResponse(
                    success=True,
                    title=title,
                    category=category,
                    description=description,
                    description_short=description_short,
                    country="Website",
                    barcode=data.barcodeData,
                    deviceId=data.deviceId
                )
            except Exception as e:
                logger.error(f"QR analysis error: {e}")
                full_desc = f"This QR code links to: {data.barcodeData}"
                short_desc = f"Unknown Link. QR code to website."
                if len(short_desc) > 138:
                    short_desc = short_desc[:135] + "..."
                return AIAnalysisResponse(
                    success=True,
                    title="Unknown Link",
                    category="Website",
                    description=full_desc,
                    description_short=short_desc,
                    country="Website",
                    barcode=data.barcodeData,
                    deviceId=data.deviceId
                )
        
        # Case 3: Unknown format
        else:
            logger.info(f"Processing unknown format: {data.barcodeData}")
            full_desc = "The scanned input is neither a recognizable barcode nor a valid URL. It may be a custom code, text string, or proprietary format."
            short_desc = "Unknown format. Not a standard barcode or URL."
            if len(short_desc) > 138:
                short_desc = short_desc[:135] + "..."
            return AIAnalysisResponse(
                success=True,
                title="Unknown",
                category="Uncategorized",
                description=full_desc,
                description_short=short_desc,
                country="Unknown",
                barcode=data.barcodeData,
                deviceId=data.deviceId
            )
    
    except Exception as e:
        logger.error(f"AI analysis error: {e}", exc_info=True)
        full_desc = "AI analysis temporarily unavailable. Please try again later or contact support if the issue persists."
        short_desc = "Analysis error. Please try again."
        if len(short_desc) > 138:
            short_desc = short_desc[:135] + "..."
        return AIAnalysisResponse(
            success=True,
            title="Unknown",
            category="Uncategorized",
            description=full_desc,
            description_short=short_desc,
            country="Unknown",
            barcode=data.barcodeData,
            deviceId=data.deviceId
        )

@app.post("/scan")
async def scan_code(data: ScanInput):
    code = data.scanned_value.strip()

    # Case 1: Numeric barcode
    if re.fullmatch(r"\d{8,14}", code):
        result = generate_barcode_info(code)
        return {"result": result}

    # Case 2: QR code / URL
    elif code.startswith(("http://", "https://", "www.")):
        result = generate_qr_info(code)
        return {"result": result}

    # Case 3: Unknown format
    else:
        return {
            "result": f"Scanned Code: {code}\nTitle: Unknown\nCategory: Uncategorized\nDescription: The scanned input is neither a recognizable barcode nor a valid URL."
        }


class ChatMessage(BaseModel):
    message: str

@app.post("/api/demo-chat")
async def demo_chat(data: ChatMessage):
    try:
        current_client = client
        if current_client is None:
            return {"reply": "API Key not configured. (Fallback Mode)"}
            
        system_prompt = """
        You are the RoBridge Support Assistant. You ONLY answer questions using the facts below, but you can also be friendly.

        === DEVICE KNOWLEDGE ===
        Fact 1: The RoBridge Scanner is an ESP32-based hardware barcode scanner.
        Fact 2: To fix a 'boot loop', 'reboot', or 'restart' issue, hold the physical reset button for 5 seconds and ensure the device is fully charged.

        === TROUBLESHOOTING GUIDE ===

        PROBLEM: Device won't power on
        CAUSE: Battery drained
        SOLUTION: Charge the device for at least 30 minutes.

        PROBLEM: Wi-Fi not connecting
        CAUSE: Incorrect Wi-Fi password
        SOLUTION: Re-enter the correct password through the Wi-Fi Portal.

        PROBLEM: Wi-Fi not connecting
        CAUSE: Weak or unstable network
        SOLUTION: Move closer to the router or check signal strength.

        PROBLEM: Barcode not detected
        CAUSE: Barcode is damaged, blurry, or reflective
        SOLUTION: Clean or reposition the barcode; avoid direct light or glare.

        PROBLEM: Barcode not detected
        CAUSE: Improper scanning distance
        SOLUTION: Maintain 10–20 cm distance from the barcode for accurate focus.

        PROBLEM: No scan sound / beep
        CAUSE: Sound setting turned off
        SOLUTION: Enable beep feedback under Settings → Sound.

        PROBLEM: Server not responding
        CAUSE: Network disconnection
        SOLUTION: Check if Wi-Fi is active or restart the device.

        PROBLEM: Server not responding
        CAUSE: Invalid server address
        SOLUTION: Verify and re-enter the correct server IP or URL in settings.

        PROBLEM: Display dim or flickering
        CAUSE: Low battery or display brightness set too low
        SOLUTION: Recharge the device or increase brightness in Display Settings.

        PROBLEM: Device overheating
        CAUSE: Continuous use or charging while scanning
        SOLUTION: Power off the device and let it cool for 10 minutes before resuming.

        === STRICT RULES ===
        1. If the user says hello or hi, greet them warmly as the RoBridge Support Assistant.
        2. If the user asks a question NOT covered by the facts above, reply EXACTLY: 'I am sorry, but I do not have information on that.'
        3. Do not guess or invent any troubleshooting steps.
        4. Keep all answers to 1-2 sentences maximum.
        5. Match the user's problem description to the closest PROBLEM above and give the corresponding SOLUTION.
        """

        response = current_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": data.message}
            ],
            temperature=0.1
        )
        
        reply = response.choices[0].message.content.strip()
        return {"reply": reply}
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return {"reply": "I am experiencing technical difficulties right now."}

# ======================
# Run Server
# ======================
if __name__ == "__main__":
    # Render-compatible port configuration
    port = int(os.getenv("PORT", 8000))
    print("=" * 60)
    print("Robridge AI Analysis Server Starting...")
    print("=" * 60)
    print(f"Server will run on: http://0.0.0.0:{port}")
    print(f"Health check: http://localhost:{port}/health")
    print(f"AI Analysis: http://localhost:{port}/api/esp32/scan")
    print("=" * 60)
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HX711.h>

// =====================================
// WI-FI & SUPABASE CONFIGURATION
// =====================================
#define WIFI_SSID     "FTTx-4a6210"
#define WIFI_PASSWORD "10008636"

#define SUPABASE_URL      "https://bxgiwnekcwuromwaprhm.supabase.co"
#define SUPABASE_ANON_KEY "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4Z2l3bmVrY3d1cm9td2FwcmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0ODM1MzksImV4cCI6MjEwNTA1OTUzOX0.9mPYrcnSBIogP19znjaIPS4f8F9oYYm0cBzEqQ2ljO4"

#define DEVICE_ID     "cc75bb44-dffa-400d-a77c-535d9c1f02fd"
#define DEVICE_SECRET "c3b61675-bc06-41db-bc01-36967a08e90b"

// =====================================
// PINS & CALIBRATION
// Zero baseline (empty scale): ~330,082 raw counts
// Raw reading with 1 KG placed: ~543,673 raw counts
// NET counts for 1 KG = 543,673 - 330,082 = 213,591
// =====================================
#define LOADCELL_DOUT_PIN 4
#define LOADCELL_SCK_PIN  5

const float COUNTS_PER_KG = 213591.0f;
const unsigned long UPLOAD_INTERVAL_MS = 5000;

HX711 scale;
long zeroReading = 0;
unsigned long lastUploadAt = 0;
bool scaleReady = false;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("Connecting to Wi-Fi: %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  for (uint8_t attempt = 0; WiFi.status() != WL_CONNECTED && attempt < 30; attempt++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi Connected! IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection failed; will retry in loop.");
  }
}

bool uploadWeight(float weightGrams) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  const String endpoint = String(SUPABASE_URL) + "/rest/v1/rpc/record_feeder_reading";

  if (!http.begin(client, endpoint)) {
    Serial.println("Failed to connect to Supabase endpoint.");
    return false;
  }

  const String body = "{\"p_device_id\":\"" + String(DEVICE_ID) +
                      "\",\"p_device_secret\":\"" + String(DEVICE_SECRET) +
                      "\",\"p_weight_grams\":" + String(weightGrams, 1) + "}";

  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");

  const int status = http.POST(body);
  const String response = http.getString();
  http.end();

  Serial.printf("Supabase response [%d]: %s\n", status, response.c_str());
  return (status >= 200 && status < 300);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("       HX711 LOAD CELL");
  Serial.println("================================");

  connectWifi();

  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);

  unsigned long startWait = millis();
  while (!scale.is_ready() && (millis() - startWait < 3000)) {
    delay(50);
  }

  if (!scale.is_ready()) {
    Serial.println("ERROR: HX711 NOT DETECTED!");
    Serial.println("Check DT (GPIO 4), SCK (GPIO 5), VCC (3.3V), and GND.");
    scaleReady = false;
  } else {
    scaleReady = true;
    Serial.println("HX711 is ready!");
    Serial.println("Taring zero baseline (keep scale empty)...");
    delay(2000);
    zeroReading = scale.read_average(15);
    Serial.print("Tare complete. Zero baseline: ");
    Serial.println(zeroReading);

    uploadWeight(0.0f);

    Serial.println();
    Serial.println("Place your weight.");
  }

  lastUploadAt = millis();
}

void loop() {
  connectWifi();

  if (!scaleReady) {
    if (scale.is_ready()) {
      scaleReady = true;
      Serial.println("HX711 connected! Taring zero baseline...");
      zeroReading = scale.read_average(15);
      uploadWeight(0.0f);
    } else {
      Serial.println("HX711 disconnected!");
      delay(2000);
      return;
    }
  }

  long rawReading = scale.read_average(10);
  long netReading = rawReading - zeroReading;

  float weightKg    = (float)netReading / COUNTS_PER_KG;
  float weightGrams = weightKg * 1000.0f;

  if (weightGrams < 1.0f) {
    weightKg    = 0.0f;
    weightGrams = 0.0f;
  }

  Serial.println("------------------------------");
  Serial.print("Raw Reading: "); Serial.println(rawReading);
  Serial.print("Weight: ");      Serial.print(weightKg, 3);    Serial.println(" kg");
  Serial.print("Weight: ");      Serial.print(weightGrams, 1); Serial.println(" g");

  if (millis() - lastUploadAt >= UPLOAD_INTERVAL_MS) {
    lastUploadAt = millis();
    uploadWeight(weightGrams);
  }

  delay(1000);
}
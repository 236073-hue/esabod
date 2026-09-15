#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HX711.h>
#include "esp32_secrets.h"

#define LOADCELL_DOUT_PIN 4
#define LOADCELL_SCK_PIN 5

// Calibrate with a known weight. Reverse its sign if adding feed decreases the reading.
const float COUNTS_PER_KG = 419430.0f;
const unsigned long UPLOAD_INTERVAL_MS = 5000;
const uint8_t SAMPLE_COUNT = 15;

HX711 scale;
long zeroReading = 0;
unsigned long lastUploadAt = 0;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (uint8_t attempt = 0; WiFi.status() != WL_CONNECTED && attempt < 30; attempt++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) Serial.printf("Wi-Fi connected: %s\n", WiFi.localIP().toString().c_str());
  else Serial.println("Wi-Fi connection failed; will retry.");
}

bool uploadWeight(float weightGrams) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  // HTTPS is still used. Replace this with the Supabase CA certificate in production.
  client.setInsecure();
  HTTPClient http;
  const String endpoint = String(SUPABASE_URL) + "/rest/v1/rpc/record_feeder_reading";
  if (!http.begin(client, endpoint)) return false;

  const String body = "{\"p_device_id\":\"" + String(DEVICE_ID) +
    "\",\"p_device_secret\":\"" + String(DEVICE_SECRET) +
    "\",\"p_weight_grams\":" + String(weightGrams, 1) + "}";
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  const int status = http.POST(body);
  const String response = http.getString();
  http.end();
  Serial.printf("Supabase response: %d\n%s\n", status, response.c_str());
  return status >= 200 && status < 300;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  if (!scale.is_ready()) {
    Serial.println("ERROR: HX711 not detected. Check DT, SCK, VCC and GND.");
    while (true) delay(1000);
  }
  Serial.println("Remove all feed from the scale. Taring in 5 seconds...");
  delay(5000);
  zeroReading = scale.read_average(20);
  Serial.printf("Tare complete. Zero reading: %ld\n", zeroReading);
  connectWifi();
  lastUploadAt = millis() - UPLOAD_INTERVAL_MS;
}

void loop() {
  connectWifi();
  if (!scale.is_ready()) {
    Serial.println("HX711 disconnected.");
    delay(1000);
    return;
  }
  const long rawReading = scale.read_average(SAMPLE_COUNT);
  const long netReading = rawReading - zeroReading;
  float weightGrams = (netReading / COUNTS_PER_KG) * 1000.0f;
  if (weightGrams < 0) weightGrams = 0;
  Serial.printf("Raw: %ld | Net: %ld | Feed: %.1f g\n", rawReading, netReading, weightGrams);
  if (millis() - lastUploadAt >= UPLOAD_INTERVAL_MS) {
    lastUploadAt = millis();
    if (!uploadWeight(weightGrams)) Serial.println("Upload failed; keeping the next scheduled retry.");
  }
  delay(250);
}

# ESP32 live feed-scale setup

## Wiring

| HX711 | ESP32 |
| --- | --- |
| DT / DOUT | GPIO 4 |
| SCK | GPIO 5 |
| VCC | 3.3V |
| GND | GND |

Install the **HX711** library (by Bogdan Necula) in Arduino IDE. No JSON library is required.

## Easy Setup (Automatic Credentials)

1. Run the updated `supabase-schema.sql` in your **Supabase Dashboard -> SQL Editor**.
   - It automatically creates an ESP32 device for your user account.
   - It outputs your `DEVICE_ID` and `DEVICE_SECRET` right in the results table!
2. **Alternative**: Log in to the web app and open `feed.html` &mdash; your `DEVICE_ID` and `DEVICE_SECRET` are displayed right there in the **ESP32 Scale Credentials** panel with 1-click **Copy** buttons.
3. Paste them into `esp32_feed_sensor/esp32_feed_sensor.ino` (or `esp32_secrets.h`).
4. Upload `esp32_feed_sensor.ino` to the ESP32 with the load cell empty; it tares itself after startup.

The board connects to Wi-Fi, prints readings to Serial Monitor (115200 baud), and posts to Supabase every 5 seconds.
The Feed page and Overview dashboard automatically detect that the ESP32 is online, start the weight at 0 g, and track live measurements.

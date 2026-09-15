# ESP32 live feed-scale setup

## Wiring

| HX711 | ESP32 |
| --- | --- |
| DT / DOUT | GPIO 4 |
| SCK | GPIO 5 |
| VCC | 3.3V |
| GND | GND |

Install the **HX711** library in Arduino IDE. No JSON library is required.

## Provision one board

1. Run the updated `supabase-schema.sql` in the Supabase SQL Editor.
2. Replace `YOUR_ACCOUNT_EMAIL` below, run it in SQL Editor, and copy the returned `id` and `device_secret`.

```sql
insert into public.feeder_devices (user_id, device_secret, name)
select id, gen_random_uuid()::text, 'Main feed scale'
from auth.users where email = 'YOUR_ACCOUNT_EMAIL'
returning id, device_secret;

update public.feeder_settings
set feed_capacity_g = 10000
where user_id = (select id from auth.users where email = 'YOUR_ACCOUNT_EMAIL');
```

3. Copy `esp32_secrets.h.example` to `esp32_secrets.h`. Fill in Wi-Fi, the project URL, anon key, and the two returned device credentials.
4. Upload `esp32_feed_sensor.ino` to the ESP32 with the load cell empty; it tares itself after five seconds.

The board posts an averaged reading every five seconds. The Feed page receives the database update through Supabase Realtime and displays the exact grams/kilograms plus its update time.

For calibration, place a known 1 kg mass after taring. If the serial monitor does not show approximately 1000 g, change `COUNTS_PER_KG` proportionally. If the number goes negative when weight is added, make the constant negative.

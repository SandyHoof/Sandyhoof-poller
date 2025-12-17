// services/trackerPollerService.js

// 1. Load environment FIRST
import dotenv from 'dotenv';
dotenv.config();
console.log(">>> DOTENV LOADED:", process.env.SUPABASE_URL);

// 2. Initialize Supabase AFTER env is loaded
import { initSupabase } from './trackerDBService.js';
initSupabase();

// 3. Import other services
console.log(">>> trackerPollerService.js loaded");

import {
  loginToLightbug,
  getTrackerClientAPI,
  getTrackerClientV2,
  fetchTrackerLiveData
} from './trackerDataService.js';

import { insertTelemetry, insertStatusIfChanged, getActiveTrackerIds } from './trackerDBService.js';

// 4. Main poller loop
async function pollLoop() {
  try {
    console.log("🔄 Starting poll loop...");

    const email = process.env.LIGHTBUG_EMAIL;
    const password = process.env.LIGHTBUG_PASSWORD;

    const token = await loginToLightbug(email, password);
    const clientAPI = getTrackerClientAPI(token);
    const clientV2 = getTrackerClientV2(token);

    const trackerSerials = await getActiveTrackerIds();

    for (const serial of trackerSerials) {
      const data = await fetchTrackerLiveData(clientAPI, clientV2, serial);
      if (!data) continue;

      const { gps, ...statusOnly } = data;
      await insertStatusIfChanged(statusOnly);

      if (data.gps) {
        await insertTelemetry({
          serial: Number(serial),          // Supabase expects BIGINT
          deviceID: String(data.deviceID), // Supabase expects TEXT
          timestamp: data.gps.timestamp,
          latitude: data.gps.lat,
          longitude: data.gps.lon,
          altitude: data.gps.altitude ?? null,
          speed: data.gps.speed ?? null,
          heading: data.gps.heading ?? null,
          accuracy: data.gps.accuracy ?? null
        });

      }
    }

  } catch (err) {
    console.error("❌ Poll loop error:", err.message);
  }

  setTimeout(pollLoop, 60000); // run every 15 seconds
}

// 5. Start the loop
pollLoop();
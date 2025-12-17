// services/trackerDataService.js
console.log(">>> trackerDataService.js loaded");

import axios from 'axios';

const BASE_URL = 'https://api.lightbug.cloud';

// In-memory cache for serial → deviceId mapping.
// We only fetch the device list once per process lifetime.
let deviceMap = null;

/* -------------------------------------------------------
   1. AUTHENTICATION (V2)
   - We still use /v2/users/login because that's how
     Lightbug issues tokens.
------------------------------------------------------- */

/**
 * Log in to Lightbug using email/password and obtain a token.
 * Uses the V2 login endpoint as per Lightbug's docs.
 *
 * @param {string} email - Lightbug account email.
 * @param {string} password - Lightbug account password.
 * @returns {Promise<string>} - The bearer token.
 */
export async function loginToLightbug(email, password) {
  console.log("🔐 Logging into Lightbug V2 /users/login...");

  const { data } = await axios.post(`${BASE_URL}/v2/users/login`, {
    username: email,
    password: password
  });

  console.log("✅ Login successful, token received.");
  return data.token; // Expected shape: { token: "..." }
}

/* -------------------------------------------------------
   2. CREATE AUTHENTICATED CLIENTS
   - V2: used ONLY for device list (serial → deviceId).
   - API: used for ALL live telemetry + status.
   - V1: OPTIONAL, used for historical tracks only.
------------------------------------------------------- */

/**
 * Create an authenticated Lightbug V2 client.
 * Used only for device enumeration and mapping.
 *
 * @param {string} token - Bearer token.
 * @returns {AxiosInstance}
 */
export function getTrackerClientV2(token) {
  console.log("⚙️  Creating Lightbug V2 client...");
  return axios.create({
    baseURL: `${BASE_URL}/v2`,
    headers: { Authorization: `Bearer ${token}` }
  });
}

/**
 * Create an authenticated Lightbug API client.
 * This is our primary client for status + live telemetry.
 *
 * @param {string} token - Bearer token.
 * @returns {AxiosInstance}
 */
export function getTrackerClientAPI(token) {
  console.log("⚙️  Creating Lightbug /api client...");
  return axios.create({
    baseURL: `${BASE_URL}/api`,
    headers: { Authorization: `Bearer ${token}` }
  });
}

/**
 * Create an authenticated Lightbug V1 client.
 * This is OPTIONAL and only used for historical tracks.
 *
 * @param {string} token - Bearer token.
 * @returns {AxiosInstance}
 */

//export function getTrackerClientV1(token) {
//  console.log("⚙️  Creating Lightbug V1 client (for historical tracks)...");
//  return axios.create({
//    baseURL: `${BASE_URL}/v1`,
//    headers: { Authorization: `Bearer ${token}` }
//  });
//}


/* -------------------------------------------------------
   3. DEVICE LIST AND SERIAL → deviceId MAP (V2)
   - We use V2 /devices once to build a map.
   - After that, everything uses deviceId + /api.
------------------------------------------------------- */

/**
 * Load the full device list from V2 and build a serial → deviceId map.
 * This is called once and cached in-memory.
 *
 * @param {AxiosInstance} clientV2 - Authenticated V2 client.
 * @returns {Promise<Object>} - Map of { [serial]: deviceId }.
 */
async function loadDeviceMap(clientV2) {
  console.log("📥 Loading device list from /v2/devices to build serial → deviceId map...");

  const { data } = await clientV2.get('/devices');
  console.log("✅ /v2/devices returned:", data);

  // Lightbug V2 usually wraps the list in data.data
  const devices = data.data || [];

  const map = {};
  for (const device of devices) {
    if (!device.serial || device.id == null) {
      console.warn("⚠️ Skipping device with missing serial or id:", device);
      continue;
    }
    map[device.serial] = device.id;
  }

  deviceMap = map;
  console.log("✅ Device map built:", map);
  return map;
}

/**
 * Get the internal deviceId for a given serial, using the cached map.
 *
 * @param {AxiosInstance} clientV2 - Authenticated V2 client.
 * @param {string} serial - Tracker serial number.
 * @returns {Promise<number | undefined>} - The internal deviceId.
 */
export async function getInternalDeviceId(clientV2, serial) {
  if (!deviceMap) {
    console.log("ℹ️ Device map not loaded yet. Loading now...");
    await loadDeviceMap(clientV2);
  }

  const deviceId = deviceMap[serial];

  if (!deviceId) {
    console.warn(`⚠️ No deviceId found in map for serial ${serial}`);
  }

  return deviceId;
}

/* -------------------------------------------------------
   4. LIVE STATUS + TELEMETRY (API)
   - /api/devices/{deviceId} is our single source of truth.
   - It always returns status.
   - It may or may not include a "points" array.
   - We handle missing/empty arrays gracefully.
------------------------------------------------------- */

/**
 * Fetch live status + latest GPS telemetry for a tracker from /api.
 *
 * This uses:
 *   GET /api/devices/{deviceId}
 *
 * Expected response shape (simplified):
 *   {
 *     id,
 *     serial,
 *     batteryPct,
 *     currentMode,
 *     lastConnection,
 *     temperature,
 *     motion,
 *     points: [
 *       {
 *         timestamp,
 *         lat,
 *         lon,
 *         speed,
 *         heading,
 *         accuracy
 *       },
 *       ...
 *     ] // points may be missing or empty
 *   }
 *
 * We normalize this into:
 *   {
 *     serial,
 *     deviceId,
 *     battery,
 *     temperature,
 *     motion,
 *     mode,
 *     lastConnection,
 *     gps: {
 *       timestamp,
 *       lat,
 *       lon,
 *       speed,
 *       heading,
 *       accuracy
 *     } | null
 *   }
 *
 * @param {AxiosInstance} clientAPI - Authenticated /api client.
 * @param {AxiosInstance} clientV2  - Authenticated V2 client (for deviceId lookup).
 * @param {string} serial - Tracker serial number.
 * @returns {Promise<Object | null>} - Normalized status + latest GPS.
 */
export async function fetchTrackerLiveData(clientAPI, clientV2, serial) {
  try {
    console.log(`📡 [LIVE] Fetching status + telemetry for serial ${serial}...`);

    // 1. Resolve deviceId
    const deviceId = await getInternalDeviceId(clientV2, serial);
    if (!deviceId) {
      console.error(`❌ [LIVE] No deviceId found for serial ${serial}. Skipping.`);
      return null;
    }

    // 2. Fetch STATUS from /devices/{id}
    const { data: statusData } = await clientAPI.get(`/devices/${deviceId}`);
    console.log(`📥 [LIVE] Status response for ${serial}:`, statusData);

    const status = {
      serial,
      deviceId,
      battery: statusData.batteryPct ?? null,
      temperature: statusData.temperature ?? null,
      motion: statusData.motion ?? null,
      mode: statusData.currentMode ?? null,
      lastConnection: statusData.lastConnection ?? null
    };

    // 3. Fetch TELEMETRY from /devices/{id}/points
    let gps = null;

    try {
      const { data: pointData } = await clientAPI.get(`/devices/${deviceId}/points`);
      console.log(`📥 [LIVE] Received ${pointData.length} points for ${serial}`);

      if (Array.isArray(pointData) && pointData.length > 0) {

        // ✅ Sort by timestamp DESC to ensure we get the newest point
        const latest = pointData
          .filter(p => p.timestamp) // ignore malformed entries
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

        if (
          latest &&
          latest.timestamp &&
          latest.location &&
          latest.location.lat != null &&
          latest.location.lng != null
        ) {
          gps = {
            timestamp: new Date(latest.timestamp).toISOString(),
            lat: latest.location.lat,
            lon: latest.location.lng,
            speed: latest.speed ?? null,
            heading: latest.course ?? null,
            accuracy: latest.accuracy ?? null,
            altitude: latest.altitude ?? null
          };

          console.log(`✅ [LIVE] Latest GPS for ${serial}:`, gps);
        } else {
          console.warn(`⚠️ [LIVE] Latest point missing fields for ${serial}:`, latest);
        }

      } else {
        console.warn(`⚠️ [LIVE] No GPS points returned for ${serial}.`);
      }

    } catch (err) {
      console.error(`❌ [LIVE] Error fetching /points for ${serial}:`, err.message);
    }

    return {
      ...status,
      gps
    };

  } catch (err) {
    console.error(`❌ [LIVE] Error fetching data for serial ${serial}:`, err.message);
    return null;
  }
}

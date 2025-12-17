// services/trackerDBService.js

console.log(">>> trackerDBService.js loaded");

import { createClient } from '@supabase/supabase-js';

let supabase = null;

/**
 * Initialize Supabase AFTER dotenv has loaded.
 * This must be called from the entry file.
 */
export function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  console.log(">>> initSupabase() called");
  console.log(">>> SUPABASE_URL:", url);
  console.log(">>> SUPABASE_SERVICE_KEY:", key ? "(loaded)" : "(missing)");

  supabase = createClient(url, key);
  console.log("✅ Supabase client initialized");
}

/**
 * Insert telemetry into deviceTelemetry table
 */
export async function insertTelemetry(telemetry) {
  const { error } = await supabase.from('deviceTelemetry').insert([telemetry]);
  if (error) console.error('❌ Supabase insert error:', error.message);
  else console.log('✅ Telemetry inserted:', telemetry);
}

/**
 * Insert status into deviceStatus table
 */
export async function insertStatus(status) {
  const { error } = await supabase.from('deviceStatus').insert([status]);

  if (error) {
    console.error(`❌ Supabase status insert error for ${status.serial}:`, error.message);
    return null;
  }

  console.log(`✅ Status inserted for ${status.serial}`);
  return true;
}

/**
 * Get last status row for a tracker
 */
export async function getLastStatus(serial) {
  const { data, error } = await supabase
    .from('deviceStatus')
    .select('*')
    .eq('serial', serial)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error(`❌ Supabase getLastStatus error for ${serial}:`, error.message);
    return null;
  }

  return data?.[0] || null;
}

/**
 * Insert status only if changed
 */
export async function insertStatusIfChanged(status) {
  const last = await getLastStatus(status.serial);

  if (!last) {
    console.log(`ℹ️ No previous status for ${status.serial}, inserting first row.`);
    return insertStatus(status);
  }

  const changed =
    last.battery !== status.battery ||
    last.temperature !== status.temperature ||
    last.motion !== status.motion ||
    last.mode !== status.mode;

  if (!changed) {
    console.log(`ℹ️ Status unchanged for ${status.serial}, skipping insert.`);
    return null;
  }

  console.log(`🔄 Status changed for ${status.serial}, inserting new row.`);
  return insertStatus(status);
}

/**
 * Get active tracker IDs from my_horses
 */
export async function getActiveTrackerIds() {
  const { data, error } = await supabase
    .from('my_horses')
    .select('trackerID, id');

  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }

  return data.map(row => row.trackerID);
}
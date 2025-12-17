---

# **Sandyhoof Poller**

The Sandyhoof Poller is a lightweight Node.js service responsible for collecting, transforming, and storing telemetry data for the Sandyhoof platform. It runs on a scheduled interval and writes structured data into the Supabase database.

## **Features**
- Modular service architecture (`services/` folder)
- Clean separation of DB access, data shaping, and polling logic
- Designed for stable, real‑time ingestion
- Minimal dependencies for easy deployment

## **Project Structure**
```
services/
  trackerDBService.js        # Database connectivity + queries
  trackerDataService.js      # Data shaping + transformation logic
  trackerPollerService.js    # Poller orchestration + scheduling
```

## **Setup**
Install dependencies:
```
npm install
```

Create a `.env` file based on `.env.example` and add your environment variables.

Run the poller:
```
node services/trackerPollerService.js
```


#!/usr/bin/env bun
import { openAppDatabase, sqlitePathFromEnv } from "../src/lib/db";
import { refreshHomepageData } from "../src/lib/homepageRefresh";
import { homepageDayWindow } from "../src/lib/homepageVolumes";

const db = openAppDatabase(sqlitePathFromEnv());
try {
  const window = homepageDayWindow();
  const data = await refreshHomepageData({
    db,
    window,
    onProgress: (progress) => {
      console.log(`${progress.completed}/${progress.total} ${progress.message}`);
    },
  });
  console.log(
    `Cached Amplitude and App Intel daily volumes for ${window.start}..${window.end} (${data.volumeWindowDays} days)`,
  );
} finally {
  db.close();
}

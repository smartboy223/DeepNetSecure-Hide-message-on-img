import exifr from 'exifr';

export async function extractAllMetadata(file: File): Promise<Record<string, string> | null> {
  try {
    // Parse all possible metadata blocks
    const data = await exifr.parse(file, {
      tiff: true,
      xmp: true,
      iptc: true,
      exif: true,
      gps: true,
      interop: true,
    });

    if (!data) return null;

    const formatted: Record<string, string> = {};

    // First pass: flatten GPS object if present
    if (data.gps && typeof data.gps === 'object') {
      const gps = data.gps as Record<string, any>;
      if (gps.latitude !== undefined) formatted['latitude'] = String(gps.latitude);
      if (gps.longitude !== undefined) formatted['longitude'] = String(gps.longitude);
      if (gps.altitude !== undefined) formatted['altitude'] = String(gps.altitude);
      if (gps.bearing !== undefined) formatted['bearing'] = String(gps.bearing);
      if (gps.accuracy !== undefined) formatted['accuracy'] = String(gps.accuracy);
    }

    // Also capture direct GPS properties
    if (data.latitude !== undefined) formatted['latitude'] = String(data.latitude);
    if (data.longitude !== undefined) formatted['longitude'] = String(data.longitude);
    if (data.altitude !== undefined) formatted['altitude'] = String(data.altitude);

    // Second pass: all other metadata
    for (const [key, value] of Object.entries(data)) {
      // Skip if already processed
      if (key === 'gps') continue;

      // Skip raw buffers or huge arrays to prevent UI lag
      if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        formatted[key] = `[Binary Data ${value.byteLength}B]`;
        continue;
      }
      if (Array.isArray(value) && value.length > 20) {
        formatted[key] = `[Array(${value.length})]`;
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        if (value instanceof Date) {
          formatted[key] = value.toLocaleString();
        } else {
          // Skip nested gps object (already flattened)
          if (key === 'gps') continue;
          try {
            const stringified = JSON.stringify(value);
            // Only include if reasonable length
            if (stringified.length < 200) {
              formatted[key] = stringified;
            }
          } catch {
            formatted[key] = '[Complex Object]';
          }
        }
      } else {
        formatted[key] = String(value);
      }
    }

    return formatted;
  } catch (e) {
    console.warn("Metadata extraction failed", e);
    return null;
  }
}

# Mobile Download Fix Documentation

## Problem

File downloads didn't work in the Shopify mobile app because:
- The previous approach used client-side Blob downloads in an embedded iframe
- Mobile WebViews restrict programmatic downloads from iframes
- The `<a download>` pattern doesn't trigger the system download manager

**Symptoms:**
- ✅ Works in desktop Shopify admin
- ✅ Works in Chrome browser on mobile devices
- ❌ **Fails in Shopify mobile app** - shows "export successful" but no file downloads

## Solution

Implemented **App Bridge Redirect.REMOTE** with **one-time download tokens**, following Shopify's official pattern for handling external redirects from embedded apps.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Embedded App (iframe/WebView)                              │
│  - User selects products and clicks Export                  │
│  - POST to server action with export data                   │
│  - Server creates one-time token                            │
│  - Client receives download URL with token                  │
│  - App Bridge Redirect.REMOTE opens URL in new context      │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Download Route (NOT embedded)                              │
│  /download?token=xxx                                        │
│  - Authenticates with Shopify                               │
│  - Validates one-time token                                 │
│  - Generates Excel file                                     │
│  - Returns with Content-Disposition: attachment             │
│  - Deletes token (one-time use)                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Database Model (DownloadToken)

```prisma
model DownloadToken {
  id        String   @id @default(uuid())
  token     String   @unique
  shop      String
  data      String   // JSON string of export data
  fileName  String
  createdAt DateTime @default(now())
}
```

**Security:**
- One-time use tokens
- 15-minute expiration
- Shop verification
- Deleted after successful download

#### 2. Server Action (app._index.jsx)

Changes from base64 response to token creation:

**Before:**
```javascript
// Generated Excel as base64 and returned to client
const wbout = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
return { success: true, fileData: wbout, fileName };
```

**After:**
```javascript
// Create secure one-time token
const token = crypto.randomUUID();

await db.downloadToken.create({
  data: {
    token,
    shop: session.shop,
    data: exportDataJson,
    fileName,
  },
});

return { success: true, downloadUrl: `/download?token=${token}` };
```

#### 3. Download Route (download.jsx)

- **NOT** under `app.` prefix (not embedded)
- Authenticates using `authenticate.admin(request)`
- Validates token and generates file
- Returns proper download headers

```javascript
return new Response(wbout, {
  status: 200,
  headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${downloadToken.fileName}"`,
    "Content-Length": wbout.length.toString(),
  },
});
```

#### 4. Client-Side (App Bridge Redirect)

**Before:**
```javascript
// Client-side Blob download (doesn't work on mobile)
const blob = new Blob([byteArray], { type: "..." });
const url = window.URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = fileName;
a.click();
```

**After:**
```javascript
// App Bridge Redirect.REMOTE (works on mobile)
const redirect = Redirect.create(shopify);
redirect.dispatch(Redirect.Action.REMOTE, {
  url: downloadUrl,
  newContext: true, // Opens in new context where downloads work
});
```

## Documentation Reference

From [Shopify App Bridge Redirect docs](https://shopify.dev/docs/api/app-bridge/previous-versions/actions/navigation/redirect-navigate):

> **Open in a new window**
> Add the `newContext` option (equivalent to `<a target="_blank">`):
>
> ```javascript
> redirect.dispatch(Redirect.Action.REMOTE, {
>   url: 'http://example.com',
>   newContext: true,
> });
> ```

This is the **official Shopify pattern** for:
- Redirecting outside the embedded app
- Opening external URLs from iframes
- Triggering downloads in mobile WebViews

## Testing Checklist

### Desktop Browser
- [x] File downloads successfully
- [x] Proper filename appears
- [x] Excel file opens correctly
- [x] Labels are formatted properly

### Shopify Desktop Admin
- [x] Download works in embedded app
- [x] Opens in new tab
- [x] Authentication persists

### Mobile Chrome/Safari
- [x] Download triggers
- [x] File appears in downloads folder

### Shopify Mobile App (Critical Test)
- [ ] **iOS Shopify app**
- [ ] **Android Shopify app**
- [ ] File downloads to device
- [ ] System download notification appears
- [ ] Excel file is accessible

## Migration Notes

### Database Migration

```bash
cd label-data-exporter
npx prisma migrate deploy  # Production
npx prisma generate        # Regenerate client
```

### Staging/Production Deployment

1. Deploy code with new download route
2. Run database migration
3. Test on mobile device before announcing

## Rollback Plan

If issues occur:

1. Revert to previous commit
2. Remove DownloadToken table:
   ```sql
   DROP TABLE "DownloadToken";
   ```
3. Re-deploy previous version

## Performance Considerations

- **Token cleanup**: Consider a background job to delete expired tokens:
  ```sql
  DELETE FROM "DownloadToken"
  WHERE "createdAt" < NOW() - INTERVAL '15 minutes';
  ```

- **Database storage**: Export data stored temporarily in database
  - Small exports (<100KB) have negligible impact
  - Large exports (>1MB) consider using file storage instead

## Future Improvements

1. **Token cleanup job**: Automated cleanup of expired tokens
2. **Progress indicator**: Show download progress for large exports
3. **File storage**: For very large exports, store files on disk/S3 instead of database
4. **Download history**: Track successful downloads for analytics

## References

- [Shopify App Bridge - Redirect](https://shopify.dev/docs/api/app-bridge/previous-versions/actions/navigation/redirect-navigate)
- [Mobile Support Best Practices](https://shopify.dev/docs/apps/build/mobile-support)
- [Built for Shopify Requirements](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)

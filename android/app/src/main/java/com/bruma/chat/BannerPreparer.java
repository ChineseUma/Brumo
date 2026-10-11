package com.bruma.chat;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;

/** Crops a banner to a wide, static JPEG without flattening profile avatars. */
final class BannerPreparer {
    static String prepare(Context context,Uri uri) throws Exception {
        byte[] bytes;
        try (InputStream input = context.getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("No se pudo abrir el banner.");
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size()+count > 10_000_000) throw new IOException("El archivo del banner supera 10 MB.");
                output.write(buffer,0,count);
            }
            bytes = output.toByteArray();
        }
        String type = AvatarFormat.detect(bytes);
        if (type == null || type.equals("image/gif")) throw new IOException("Elige un banner PNG, JPEG o WebP. Se guardará como imagen estática.");
        Bitmap source;
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            source = android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes)),(decoder,info,ignored) -> {
                double scale = Math.min(1d,1200d/Math.max(info.getSize().getWidth(),info.getSize().getHeight()));
                decoder.setTargetSize(Math.max(1,(int)(info.getSize().getWidth()*scale)),Math.max(1,(int)(info.getSize().getHeight()*scale)));
                decoder.setAllocator(android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE);
            });
        } else {
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Imagen inválida.");
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
            while (Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize > 1200) options.inSampleSize *= 2;
            source = BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
        }
        if (source == null) throw new IOException("No se pudo leer el banner.");
        Bitmap banner = null;
        try {
            banner = Bitmap.createBitmap(1200,480,Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(banner); canvas.drawColor(0xff500606);
            float scale = Math.max(1200f/source.getWidth(),480f/source.getHeight());
            float width = source.getWidth()*scale, height = source.getHeight()*scale;
            canvas.drawBitmap(source,null,new android.graphics.RectF((1200-width)/2,(480-height)/2,(1200+width)/2,(480+height)/2),new Paint(Paint.FILTER_BITMAP_FLAG));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            for (int quality=85;quality>=55;quality-=10) {
                output.reset(); banner.compress(Bitmap.CompressFormat.JPEG,quality,output);
                if (output.size()<=1_000_000) return "data:image/jpeg;base64,"+Base64.encodeToString(output.toByteArray(),Base64.NO_WRAP);
            }
            throw new IOException("El banner preparado supera 1 MB. Elige otra imagen.");
        } finally { source.recycle(); if (banner != null) banner.recycle(); }
    }
}

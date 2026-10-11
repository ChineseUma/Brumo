package com.bruma.chat;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;

/** Profile uploads use their file signatures, rather than unreliable picker MIME types. */
final class AvatarPreparer {
    static final int MAX_BYTES = 4_000_000;
    static String prepare(Context context, Uri uri) throws Exception {
        byte[] bytes;
        try (InputStream input = context.getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("No se pudo abrir la foto de perfil.");
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > MAX_BYTES) throw new IOException("La foto de perfil supera 4 MB.");
                output.write(buffer,0,count);
            }
            bytes = output.toByteArray();
        }
        String type = AvatarFormat.detect(bytes);
        if (type == null) throw new IOException("El archivo no es una imagen PNG, JPEG, WebP o GIF válida.");
        if (type.equals("image/gif")) {
            int width = (bytes[6]&255) | ((bytes[7]&255)<<8);
            int height = (bytes[8]&255) | ((bytes[9]&255)<<8);
            if (width < 1 || height < 1 || width > 1024 || height > 1024)
                throw new IOException("El GIF de perfil debe medir como máximo 1024 × 1024 px.");
            // Keep the original bytes and every frame.
        } else if (!AvatarFormat.animatedWebp(bytes)) {
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("No se pudo leer la foto de perfil.");
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 1;
            while (Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize > 512) options.inSampleSize *= 2;
            Bitmap original;
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                original = android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes)),(decoder,info,source) -> {
                    double factor = Math.min(1d,256d/Math.max(info.getSize().getWidth(),info.getSize().getHeight()));
                    decoder.setTargetSize(Math.max(1,(int)Math.round(info.getSize().getWidth()*factor)),Math.max(1,(int)Math.round(info.getSize().getHeight()*factor)));
                    decoder.setAllocator(android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE);
                });
            } else original = BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            if (original == null) throw new IOException("No se pudo leer la foto de perfil.");
            Bitmap scaled = null;
            try {
                double scale = Math.min(1d,256d/Math.max(original.getWidth(),original.getHeight()));
                scaled = Bitmap.createScaledBitmap(original,Math.max(1,(int)Math.round(original.getWidth()*scale)),Math.max(1,(int)Math.round(original.getHeight()*scale)),true);
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (!scaled.compress(Bitmap.CompressFormat.PNG,100,output)) throw new IOException("No se pudo preparar la foto de perfil.");
                bytes = output.toByteArray(); type = "image/png";
            } finally { if (scaled != null && scaled != original) scaled.recycle(); original.recycle(); }
        }
        return "data:"+type+";base64,"+Base64.encodeToString(bytes,Base64.NO_WRAP);
    }
}

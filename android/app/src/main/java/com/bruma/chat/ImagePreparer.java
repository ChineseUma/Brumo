package com.bruma.chat;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ColorSpace;
import android.graphics.ImageDecoder;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;

/** Prepares photos on disk; preserves animated files without flattening their frames. */
final class ImagePreparer {
    static final int MAX_DIMENSION = 1600;
    static final int TARGET_BYTES = 1_000_000;
    static final class Result {
        final File file; final String type;
        Result(File file, String type) { this.file = file; this.type = type; }
    }
    static Result prepare(Context context, Uri uri, String type) throws Exception {
        File source = File.createTempFile("bruma-image-", ".source", context.getCacheDir());
        File encoded = null;
        Bitmap bitmap = null;
        boolean retain = false;
        try {
            try (InputStream input = context.getContentResolver().openInputStream(uri);
                 FileOutputStream output = new FileOutputStream(source)) {
                if (input == null) throw new IOException("No se pudo abrir la imagen.");
                byte[] buffer = new byte[16384]; int count; long size = 0;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Preparación cancelada.");
                    size += count;
                    if (size > 30_000_000) throw new IOException("La imagen original supera 30 MB.");
                    output.write(buffer, 0, count);
                }
            }
            if (type.equals("image/gif") || type.equals("image/webp") && animatedWebp(source)) {
                if (source.length() > 10_000_000) throw new IOException("La animación supera 10 MB.");
                retain = true; return new Result(source, type);
            }
            if (Build.VERSION.SDK_INT >= 28) {
                bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(source), (decoder, info, ignored) -> {
                    int w = info.getSize().getWidth(), h = info.getSize().getHeight();
                    double scale = Math.min(1d, MAX_DIMENSION / (double) Math.max(w, h));
                    decoder.setTargetSize(Math.max(1, (int) Math.round(w * scale)), Math.max(1, (int) Math.round(h * scale)));
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                    decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB));
                });
            } else {
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(source.getPath(), bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Imagen inválida.");
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
                options.inPreferredConfig = Bitmap.Config.ARGB_8888;
                options.inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB);
                while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > MAX_DIMENSION) options.inSampleSize *= 2;
                bitmap = BitmapFactory.decodeFile(source.getPath(), options);
                if (bitmap == null) throw new IOException("Imagen inválida.");
                Matrix matrix = new Matrix();
                int orientation = new ExifInterface(source.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
                switch (orientation) {
                    case 2: matrix.setScale(-1, 1); break;
                    case 3: matrix.setRotate(180); break;
                    case 4: matrix.setScale(1, -1); break;
                    case 5: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                    case 6: matrix.setRotate(90); break;
                    case 7: matrix.setRotate(270); matrix.postScale(-1, 1); break;
                    case 8: matrix.setRotate(270); break;
                }
                if (!matrix.isIdentity()) {
                    Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                    if (rotated != bitmap) { bitmap.recycle(); bitmap = rotated; }
                }
                bitmap = resize(bitmap, MAX_DIMENSION);
            }
            if (bitmap == null) throw new IOException("Imagen inválida.");
            encoded = File.createTempFile("bruma-image-", ".webp", context.getCacheDir());
            compress(bitmap, encoded, 82);
            if (encoded.length() > TARGET_BYTES) compress(bitmap, encoded, 72);
            for (int dimension = 1280; encoded.length() > TARGET_BYTES && dimension >= 640; dimension /= 2) {
                bitmap = resize(bitmap, dimension); compress(bitmap, encoded, 72);
            }
            if (source.length() <= encoded.length() && source.length() <= 10_000_000) {
                retain = true; return new Result(source, type);
            }
            if (encoded.length() > 10_000_000) throw new IOException("La imagen supera 10 MB.");
            File result = encoded; encoded = null; return new Result(result, "image/webp");
        } finally {
            if (bitmap != null) bitmap.recycle();
            if (!retain) source.delete();
            if (encoded != null) encoded.delete();
        }
    }
    private static Bitmap resize(Bitmap bitmap, int maximum) {
        int largest = Math.max(bitmap.getWidth(), bitmap.getHeight());
        if (largest <= maximum) return bitmap;
        double scale = maximum / (double) largest;
        Bitmap result = Bitmap.createScaledBitmap(bitmap, Math.max(1, (int) Math.round(bitmap.getWidth() * scale)), Math.max(1, (int) Math.round(bitmap.getHeight() * scale)), true);
        if (result != bitmap) bitmap.recycle(); return result;
    }
    @SuppressWarnings("deprecation")
    private static void compress(Bitmap bitmap, File file, int quality) throws IOException {
        Bitmap.CompressFormat format = Build.VERSION.SDK_INT >= 30 ? Bitmap.CompressFormat.WEBP_LOSSY : Bitmap.CompressFormat.WEBP;
        try (FileOutputStream output = new FileOutputStream(file)) {
            if (!bitmap.compress(format, quality, output)) throw new IOException("No se pudo preparar la imagen.");
        }
    }
    static boolean animatedWebp(File file) throws IOException {
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] header = new byte[21]; int used = 0, count;
            while (used < header.length && (count = input.read(header, used, header.length - used)) != -1) used += count;
            return used == 21 && header[12] == 'V' && header[13] == 'P' && header[14] == '8' && header[15] == 'X' && (header[20] & 2) != 0;
        }
    }
}

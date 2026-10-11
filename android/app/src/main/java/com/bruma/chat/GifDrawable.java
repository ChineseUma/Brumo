package com.bruma.chat;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Movie;
import android.graphics.PixelFormat;
import android.graphics.drawable.Animatable;
import android.graphics.drawable.Drawable;
import android.os.SystemClock;

/** GIF animation on Android 8, before ImageDecoder became available. */
final class GifDrawable extends Drawable implements Animatable, Runnable {
    private final Movie movie;
    private boolean running;
    private long started;
    GifDrawable(Movie movie) { this.movie = movie; }
    @Override public void draw(Canvas canvas) {
        int duration = movie.duration() > 0 ? movie.duration() : 1000;
        movie.setTime((int)((SystemClock.uptimeMillis()-started)%duration));
        canvas.save(); canvas.translate(getBounds().left,getBounds().top);
        canvas.scale(getBounds().width()/(float)movie.width(),getBounds().height()/(float)movie.height());
        movie.draw(canvas,0,0); canvas.restore();
    }
    @Override public int getIntrinsicWidth() { return movie.width(); }
    @Override public int getIntrinsicHeight() { return movie.height(); }
    @Override public void start() { if (running) return; running = true; started = SystemClock.uptimeMillis(); run(); }
    @Override public void stop() { running = false; unscheduleSelf(this); }
    @Override public boolean isRunning() { return running; }
    @Override public void run() { if (running) { invalidateSelf(); scheduleSelf(this,SystemClock.uptimeMillis()+40); } }
    @Override public void setAlpha(int alpha) { }
    @Override public void setColorFilter(ColorFilter filter) { }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}

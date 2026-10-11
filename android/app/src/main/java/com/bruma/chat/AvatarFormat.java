package com.bruma.chat;

/** Small signature reader shared by the profile importer and its JVM regression tests. */
final class AvatarFormat {
    static String detect(byte[] b) {
        if (b.length >= 13 && starts(b,new byte[]{'G','I','F','8'}) && (b[4]=='7' || b[4]=='9') && b[5]=='a') return "image/gif";
        if (b.length >= 8 && starts(b,new byte[]{(byte)137,80,78,71,13,10,26,10})) return "image/png";
        if (b.length >= 3 && (b[0]&255)==255 && (b[1]&255)==216 && (b[2]&255)==255) return "image/jpeg";
        if (b.length >= 12 && b[0]=='R' && b[1]=='I' && b[2]=='F' && b[3]=='F' && b[8]=='W' && b[9]=='E' && b[10]=='B' && b[11]=='P') return "image/webp";
        return null;
    }
    static boolean animatedWebp(byte[] b) {
        if (!"image/webp".equals(detect(b))) return false;
        int offset = 12;
        while (offset + 8 <= b.length) {
            long size = (b[offset+4]&255L) | ((b[offset+5]&255L)<<8) | ((b[offset+6]&255L)<<16) | ((b[offset+7]&255L)<<24);
            if (size > b.length-offset-8) return false;
            if (b[offset]=='V' && b[offset+1]=='P' && b[offset+2]=='8' && b[offset+3]=='X' && size >= 1 && (b[offset+8]&2)!=0) return true;
            offset += 8 + (int)size + ((int)size&1);
        }
        return false;
    }
    private static boolean starts(byte[] data,byte[] prefix) {
        for (int i=0;i<prefix.length;i++) if (data[i]!=prefix[i]) return false;
        return true;
    }
}

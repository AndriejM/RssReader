package pl.andriejsoft.rssreader.utils;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import org.apache.commons.io.IOUtils;
import org.apache.tomcat.util.codec.binary.Base64;

public class StringCompressor {

  public static String compressString(String srcTxt)
      throws IOException {
    ByteArrayOutputStream rstBao = new ByteArrayOutputStream();
    GZIPOutputStream zos = new GZIPOutputStream(rstBao);
    zos.write(srcTxt.getBytes());
    IOUtils.closeQuietly(zos);

    byte[] bytes = rstBao.toByteArray();
    // In my solr project, I use org.apache.solr.co mmon.util.Base64.
    // return = org.apache.solr.common.util.Base64.byteArrayToBase64(bytes, 0,
    // bytes.length);
    return Base64.encodeBase64String(bytes);
  }

  public static String uncompressString(String zippedBase64Str)
      throws IOException {
    String result = null;

    // In my solr project, I use org.apache.solr.common.util.Base64.
    // byte[] bytes =
    // org.apache.solr.common.util.Base64.base64ToByteArray(zippedBase64Str);
    byte[] bytes = Base64.decodeBase64(zippedBase64Str);
    GZIPInputStream zi = null;
    try {
      zi = new GZIPInputStream(new ByteArrayInputStream(bytes));
      result = IOUtils.toString(zi);
    } finally {
      IOUtils.closeQuietly(zi);
    }
    return result;
  }
}

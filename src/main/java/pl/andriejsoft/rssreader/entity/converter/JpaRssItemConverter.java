package pl.andriejsoft.rssreader.entity.converter;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import java.io.IOException;
import lombok.extern.slf4j.Slf4j;
import pl.andriejsoft.rssreader.entity.model.RssItemPayload;
import pl.andriejsoft.rssreader.utils.CustomObjectMapper;
import pl.andriejsoft.rssreader.utils.StringCompressor;

@Slf4j
@Converter
public class JpaRssItemConverter implements AttributeConverter<RssItemPayload, String> {

  private final static ObjectMapper objectMapper = CustomObjectMapper.objectMapper;

  @Override
  public String convertToDatabaseColumn(RssItemPayload attribute) {
    String jsonString = "";
    try {
      jsonString = StringCompressor.compressString(objectMapper.writeValueAsString(attribute));
    } catch (Exception ex) {
      log.error(ex.getMessage());
    }
    return jsonString;
  }

  @Override
  public RssItemPayload convertToEntityAttribute(String dbData) {

    RssItemPayload payload = new RssItemPayload();
    try {
      payload = objectMapper.readValue(StringCompressor.uncompressString(dbData),
          RssItemPayload.class);
    } catch (IOException ex) {
      log.error(ex.getMessage());
    }
    return payload;
  }
}

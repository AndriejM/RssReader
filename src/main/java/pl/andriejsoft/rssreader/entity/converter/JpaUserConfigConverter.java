package pl.andriejsoft.rssreader.entity.converter;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import java.io.IOException;
import lombok.extern.slf4j.Slf4j;
import pl.andriejsoft.rssreader.entity.model.UserConfigPayload;
import pl.andriejsoft.rssreader.utils.CustomObjectMapper;

@Slf4j
@Converter
public class JpaUserConfigConverter implements AttributeConverter<UserConfigPayload, String> {

  private final static ObjectMapper objectMapper = CustomObjectMapper.objectMapper;

  @Override
  public String convertToDatabaseColumn(UserConfigPayload attribute) {
    String jsonString = "";
    try {
      jsonString = objectMapper.writeValueAsString(attribute);
    } catch (JsonProcessingException ex) {
      log.error(ex.getMessage());
    }
    return jsonString;
  }

  @Override
  public UserConfigPayload convertToEntityAttribute(String dbData) {

    UserConfigPayload payload = new UserConfigPayload();
    try {
      payload = objectMapper.readValue(dbData, UserConfigPayload.class);
    } catch (IOException ex) {
      log.error(ex.getMessage());
    }
    return payload;
  }
}

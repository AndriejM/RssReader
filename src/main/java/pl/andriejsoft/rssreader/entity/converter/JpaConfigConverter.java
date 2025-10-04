package pl.andriejsoft.rssreader.entity.converter;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import lombok.extern.slf4j.Slf4j;
import pl.andriejsoft.rssreader.entity.model.ConfigPayload;

import java.io.IOException;

@Slf4j
@Converter
public class JpaConfigConverter implements AttributeConverter<ConfigPayload, String> {

        // ObjectMapper is thread safe
        private final static ObjectMapper objectMapper = new ObjectMapper();

        @Override
        public String convertToDatabaseColumn(ConfigPayload attribute) {
            String jsonString = "";
            try {
                log.debug("Start convertToDatabaseColumn");

                // convert list of POJO to json
                jsonString = objectMapper.writeValueAsString(attribute);
                log.debug("convertToDatabase:" + jsonString);

            } catch (JsonProcessingException ex) {
                log.error(ex.getMessage());
            }
            return jsonString;
        }

        @Override
        public ConfigPayload convertToEntityAttribute(String dbData) {

            ConfigPayload payload = new ConfigPayload();
            try {
                log.debug("Start convertToEntityAttribute dbData:"  + dbData);

                // convert json to list of POJO
                payload = objectMapper.readValue(dbData, ConfigPayload.class);
                log.debug("convertToEntity:" + payload);

            } catch (IOException ex) {
                log.error(ex.getMessage());
            }
            return payload;

        }
}

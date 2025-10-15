package pl.andriejsoft.rssreader.utils;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Arrays;
import lombok.SneakyThrows;
import lombok.experimental.UtilityClass;
import lombok.extern.slf4j.Slf4j;

@UtilityClass
@Slf4j
public class LogHelper {

  private static final ObjectMapper objectMapper = CustomObjectMapper.objectMapper;

  public static void info(String message, Object ... args) {
    Object[] objects = Arrays.stream(args).map(o -> {
      try {
        return objectMapper.writeValueAsString(o);
      } catch (JsonProcessingException e) {
        throw new RuntimeException(e);
      }
    }).toArray();
    log.info(message, objects);
  }

  public static void debug(String message, Object ... args) {
    Object[] objects = Arrays.stream(args).map(o -> {
      try {
        return objectMapper.writeValueAsString(o);
      } catch (JsonProcessingException e) {
        throw new RuntimeException(e);
      }
    }).toArray();
    log.debug(message, objects);
  }

  @SneakyThrows
  public static void error(String message, Object ... args) {
    Object[] objects = Arrays.stream(args).map(o -> {
      try {
        return objectMapper.writeValueAsString(o);
      } catch (JsonProcessingException e) {
        throw new RuntimeException(e);
      }
    }).toArray();
    log.error(message, objects);
  }

}

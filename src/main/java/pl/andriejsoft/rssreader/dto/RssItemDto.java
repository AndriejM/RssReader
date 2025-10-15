package pl.andriejsoft.rssreader.dto;

import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Value;
import pl.andriejsoft.rssreader.entity.model.RssItemPayload;
import pl.andriejsoft.rssreader.enums.RssItemStatus;

@Value
@Builder
public class RssItemDto {

  Long id;

  Long userId;

  String groupUuid;

  String rssUuid;

  RssItemStatus status;

  String link;

  LocalDateTime pubDate;

  RssItemPayload itemPayload;
}
package pl.andriejsoft.rssreader.entity;

import java.time.LocalDateTime;
import pl.andriejsoft.rssreader.enums.RssItemStatus;

public interface RssItemProjection {

  Long getId();

  Long getUserId();

  String getGroupUuid();

  String getRssUuid();

  RssItemStatus getStatus();

  String getLink();

  LocalDateTime getPubDate();
}
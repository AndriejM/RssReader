package pl.andriejsoft.rssreader.entity.model;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class JobParams {
  private Long userId;
  private String groupUuid;
  private RssConfig rss;
}

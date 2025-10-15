package pl.andriejsoft.rssreader.entity.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Builder.Default;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AppConfigPayload {

  private Long defaultUserId;

  @Default
  private Integer daysForSetRead = 3;

  @Default
  private Integer daysForCleanRssItems = 4;
}

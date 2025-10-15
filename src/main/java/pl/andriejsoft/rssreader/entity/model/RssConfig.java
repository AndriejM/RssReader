package pl.andriejsoft.rssreader.entity.model;

import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RssConfig {

  @Builder.Default
  private String uuid = UUID.randomUUID().toString();
  private String name;
  private String url;
  private String refreshCronExpression;
}

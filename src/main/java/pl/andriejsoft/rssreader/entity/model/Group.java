package pl.andriejsoft.rssreader.entity.model;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Group {

  @Builder.Default
  private String uuid = UUID.randomUUID().toString();
  private String name;
  @Builder.Default
  private List<RssConfig> rssConfigs = new ArrayList<>();
}

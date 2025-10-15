package pl.andriejsoft.rssreader.entity.model;

import java.util.ArrayList;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserConfigPayload {

  private String defaultCronExpression;
  @Builder.Default
  private List<Group> groups = new ArrayList<>();
}

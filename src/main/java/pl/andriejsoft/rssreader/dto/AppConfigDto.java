package pl.andriejsoft.rssreader.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import pl.andriejsoft.rssreader.entity.model.AppConfigPayload;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AppConfigDto {

  private Long id;
  private AppConfigPayload appConfigPayload;
}
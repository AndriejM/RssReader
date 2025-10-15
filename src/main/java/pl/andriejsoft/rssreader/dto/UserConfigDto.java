package pl.andriejsoft.rssreader.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import pl.andriejsoft.rssreader.entity.model.UserConfigPayload;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserConfigDto {

  private Long id;

  private UserConfigPayload userConfigPayload;

  private String userName;
}
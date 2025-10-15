package pl.andriejsoft.rssreader.dto;

import lombok.Builder;
import lombok.Getter;

@Builder
@Getter
public class UserDto {

  private Long id;
  private String userName;
}

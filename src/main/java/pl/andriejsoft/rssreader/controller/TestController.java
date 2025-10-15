package pl.andriejsoft.rssreader.controller;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pl.andriejsoft.rssreader.dto.RssItemDto;
import pl.andriejsoft.rssreader.service.DynamicScheduler;
import pl.andriejsoft.rssreader.service.RssLoaderService;

@RequestMapping("/test")
@RestController
@RequiredArgsConstructor
public class TestController {

  @Autowired
  private RssLoaderService rssLoaderService;

  @Autowired
  private DynamicScheduler dynamicScheduler;

  @GetMapping("/startLoadScheduler")
  public String startLoadScheduler() {
    dynamicScheduler.startSchedulersForCurrentUser();
    return "Loaded rss";
  }

  @GetMapping("/rssList")
  public List<RssItemDto> getRss() {
    return rssLoaderService.getRssItemsForCurrentUser();
  }

  @GetMapping("/rss/{id}")
  public RssItemDto getRssById(@PathVariable Long id) {
    return rssLoaderService.getRssItemsById(id);
  }
}

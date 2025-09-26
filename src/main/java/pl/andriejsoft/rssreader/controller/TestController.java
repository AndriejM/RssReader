package pl.andriejsoft.rssreader.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RequestMapping("/test")
@RestController
@RequiredArgsConstructor
public class TestController {

  @GetMapping("/test/{name}")
  public String sendNotificationEvent(@PathVariable String name) {
    return "Welcome " + name;
  }
}
